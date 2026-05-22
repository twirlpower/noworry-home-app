// Offline storage + sync for the HomeTech field app.
//
// IndexedDB schema:
//   pending_assessments         — assessments awaiting sync to Supabase
//   pending_findings            — assessment findings awaiting sync
//   pending_checklist_completions — quarterly checklist completions
//   cached_homes                — tech_list_homes() results cached so the
//                                 Homes list works offline
//
// v1 scope: cached_homes is fully functional (cache + offline fallback).
// The three pending_* stores are real, but their producers ship in 19b
// (assessments) and 19c (checklist). syncAll iterates them and is a
// no-op today — wire real POSTs when those pages land.
//
// idb is a tiny (~5KB gz) Promise wrapper around IndexedDB.

import { openDB } from 'idb'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const DB_NAME = 'noworry-tech-offline'
const DB_VERSION = 1

export const STORES = {
  assessments: 'pending_assessments',
  findings: 'pending_findings',
  completions: 'pending_checklist_completions',
  homes: 'cached_homes',
}

// Single shared connection. Awaiting openDB inside every helper is cheap
// after the first call (idb caches the upgrade outcome) but caching the
// promise avoids the cold-start overhead each tick.
let dbPromise = null
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORES.assessments)) {
          db.createObjectStore(STORES.assessments, { keyPath: 'id', autoIncrement: true })
        }
        if (!db.objectStoreNames.contains(STORES.findings)) {
          db.createObjectStore(STORES.findings, { keyPath: 'id', autoIncrement: true })
        }
        if (!db.objectStoreNames.contains(STORES.completions)) {
          db.createObjectStore(STORES.completions, { keyPath: 'id', autoIncrement: true })
        }
        if (!db.objectStoreNames.contains(STORES.homes)) {
          // cached_homes keyed by circle_id (one entry per home).
          db.createObjectStore(STORES.homes, { keyPath: 'circle_id' })
        }
      },
    }).catch((err) => {
      // Private mode / blocked storage — fall back to a no-op DB so
      // callers don't crash. They get an empty cache + no offline saves.
      console.warn('[techSync] IndexedDB unavailable:', err?.message)
      return null
    })
  }
  return dbPromise
}

// ── Pending-store helpers ────────────────────────────────────────────────
// All write paths swallow IndexedDB-unavailable errors; callers should
// treat a thrown error as "client is too restricted for offline mode"
// and fall back to network-only.

export async function saveLocally(store, data) {
  const db = await getDb()
  if (!db) return null
  return db.add(store, { ...data, savedAt: new Date().toISOString() })
}

export async function getPending(store) {
  const db = await getDb()
  if (!db) return []
  return db.getAll(store)
}

export async function markSynced(store, id) {
  const db = await getDb()
  if (!db) return
  return db.delete(store, id)
}

// ── Home cache (functional today) ────────────────────────────────────────

export async function cacheHomes(homes) {
  const db = await getDb()
  if (!db) return
  const tx = db.transaction(STORES.homes, 'readwrite')
  // Replace the whole cache atomically. A clear + put-all is simpler than
  // a diff-and-upsert; the home list is small.
  await tx.store.clear()
  for (const h of homes) {
    if (h?.circle_id) await tx.store.put(h)
  }
  await tx.done
}

export async function getCachedHomes() {
  const db = await getDb()
  if (!db) return []
  return db.getAll(STORES.homes)
}

// ── Counts across all pending stores ─────────────────────────────────────

export async function getPendingCount() {
  const db = await getDb()
  if (!db) return 0
  const [a, f, c] = await Promise.all([
    db.count(STORES.assessments),
    db.count(STORES.findings),
    db.count(STORES.completions),
  ])
  return a + f + c
}

// ── Assessment payload shape ────────────────────────────────────────────
// An assessment payload queued for sync looks like:
//   {
//     id:        (assigned by IndexedDB autoIncrement),
//     circleId:  uuid,
//     homeId:    uuid,
//     userId:    uuid,
//     home:      { stories, hvac_system_count, dryer_vent_exit, property_tier },
//     systems:   [{ system_type, manufacturer, model_number, serial_number,
//                   install_year, location_notes, condition_notes,
//                   filter_size, assessment_method, photo: Blob|null }],
//     hazards:   [{ hazard_type, present, notes, photo: Blob|null }],
//     queuedAt:  ISO timestamp,
//   }
//
// Blobs survive IndexedDB structured-clone, so photos can be queued as
// captured. On sync we upload each Blob to storage, then collect the
// resulting object_path strings into the row inserts.

function buildSystemName(s) {
  const parts = [s.manufacturer, s.model_number].filter(Boolean)
  if (parts.length) return parts.join(' ').trim()
  // Fallback to a human-ish label per system_type. The DB column is
  // NOT NULL so we must provide something.
  return `${(s.system_type || 'system').replace(/_/g, ' ')}`
}

async function uploadPhoto(blob, pathPrefix) {
  if (!blob) return null
  const ext = blob.type === 'image/png' ? 'png' : 'jpg'
  const path = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('tech-photos').upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return path
}

// Pushes a single queued assessment all the way to Supabase. Throws on
// any failure — the caller leaves the entry in IndexedDB for the next
// sync attempt.
async function syncOneAssessment(p) {
  // 1. Upload photos sequentially. Bulk parallelism doesn't help here
  //    and tighter serial control simplifies retry semantics.
  const systemsWithPaths = []
  for (const s of p.systems ?? []) {
    const photo_path = s.photo
      ? await uploadPhoto(s.photo, `${p.homeId}/systems/${s.system_type}`)
      : null
    systemsWithPaths.push({ ...s, photo_path })
  }

  const hazardsWithPaths = []
  for (const h of p.hazards ?? []) {
    const photo_path = h.photo
      ? await uploadPhoto(h.photo, `${p.homeId}/hazards/${h.hazard_type}`)
      : null
    hazardsWithPaths.push({ ...h, photo_path })
  }

  // 2. Insert home_systems rows. Synthesize the NOT NULL `name` column.
  const systemRows = systemsWithPaths.map((s) => ({
    home_id:           p.homeId,
    system_type:       s.system_type,
    name:              buildSystemName(s),
    manufacturer:      s.manufacturer ?? null,
    model_number:      s.model_number ?? null,
    serial_number:     s.serial_number ?? null,
    install_year:      s.install_year ?? null,
    location_notes:    s.location_notes ?? null,
    condition_notes:   s.condition_notes ?? null,
    filter_size:       s.filter_size ?? null,
    photo_path:        s.photo_path,
    assessed_by:       p.userId ?? null,
    assessed_at:       new Date().toISOString(),
    assessment_method: s.assessment_method ?? 'manual',
    // Mirror to legacy columns for any consumers still reading them.
    brand:             s.manufacturer ?? null,
    model:             s.model_number ?? null,
    location_in_home:  s.location_notes ?? null,
    notes:             s.condition_notes ?? null,
  }))

  if (systemRows.length) {
    const { error } = await supabase.from('home_systems').insert(systemRows)
    if (error) throw error
  }

  // 3. Insert home_hazards rows (only the ones present OR explicitly
  //    checked clear — both are useful audit data).
  const hazardRows = hazardsWithPaths.map((h) => ({
    home_id:     p.homeId,
    hazard_type: h.hazard_type,
    present:     !!h.present,
    notes:       h.notes ?? null,
    photo_path:  h.photo_path,
    assessed_by: p.userId ?? null,
    assessed_at: new Date().toISOString(),
  }))

  if (hazardRows.length) {
    const { error } = await supabase.from('home_hazards').insert(hazardRows)
    if (error) throw error
  }

  // 4. Update homes with overview answers + assessment completion.
  const propertyTier =
    p.home?.hvac_system_count >= 2 || p.home?.dryer_vent_exit === 'roof'
      ? 'enhanced'
      : 'standard'

  const { error: hErr } = await supabase
    .from('homes')
    .update({
      stories:             p.home?.stories ?? null,
      hvac_system_count:   p.home?.hvac_system_count ?? null,
      dryer_vent_exit:     p.home?.dryer_vent_exit ?? null,
      property_tier:       propertyTier,
      assessment_complete: true,
      assessment_date:     new Date().toISOString(),
      assessment_tech_id:  p.userId ?? null,
    })
    .eq('id', p.homeId)
  if (hErr) throw hErr

  return { systems: systemRows.length, hazards: hazardRows.length }
}

// Public: submit an assessment. Tries online first; on any failure
// queues to IndexedDB. Returns { mode: 'synced' | 'queued', detail }.
export async function submitAssessment(payload) {
  // Always queue first — that way a crash mid-network doesn't lose the
  // tech's work. Then attempt sync immediately. On success, markSynced.
  let id = null
  try {
    id = await saveLocally(STORES.assessments, payload)
  } catch (e) {
    console.warn('[techSync] could not queue assessment', e?.message)
  }

  if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
    try {
      const result = await syncOneAssessment(payload)
      if (id != null) await markSynced(STORES.assessments, id).catch(() => {})
      return { mode: 'synced', detail: result }
    } catch (e) {
      console.warn('[techSync] online submit failed, kept in queue', e?.message)
      return { mode: 'queued', detail: { reason: e?.message ?? 'network_error' } }
    }
  }
  return { mode: 'queued', detail: { reason: 'offline' } }
}

// Walks pending_assessments and syncs each. Stops on first failure so a
// flaky upload doesn't burn through every queued item. Per-spec the
// other two pending stores are still owned by their 19c implementations.
export async function syncAll() {
  const db = await getDb()
  if (!db) return { synced: 0, remaining: 0 }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { synced: 0, remaining: await getPendingCount() }
  }

  let synced = 0
  const pending = await db.getAll(STORES.assessments)
  for (const item of pending) {
    try {
      await syncOneAssessment(item)
      await markSynced(STORES.assessments, item.id)
      synced += 1
    } catch (e) {
      console.warn('[techSync] sync failed mid-batch, will retry', e?.message)
      break
    }
  }

  // TODO(19c): pending_findings and pending_checklist_completions
  // sync handlers land with the checklist UI.

  return { synced, remaining: await getPendingCount() }
}

// Auto-sync on online. The handler swallows errors so listener teardown
// isn't surprising.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncAll().catch(() => {})
  })
}

// ── React hook: useSyncStatus ────────────────────────────────────────────

export function useSyncStatus() {
  // Lazy init keeps navigator.onLine out of an effect (it's pure-ish and
  // safe in the initializer; the value updates via listeners below).
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    function onOnline() { setIsOnline(true) }
    function onOffline() { setIsOnline(false) }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    // Initial + poll every 10s. Real-time sync notifications would be
    // better but polling is fine for the volumes here.
    function refresh() {
      getPendingCount().then((n) => {
        if (!cancelled) setPendingCount(n)
      })
    }
    refresh()
    const id = setInterval(refresh, 10000)

    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return { pendingCount, isOnline }
}
