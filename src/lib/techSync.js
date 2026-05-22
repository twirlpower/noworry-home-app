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

// ── Sync orchestrator ────────────────────────────────────────────────────
// v1 stub: walks each pending store and would POST to Supabase. The actual
// shape of the payloads + target tables is owned by 19b (assessments) and
// 19c (checklist), so the inner conversion is a TODO. Returns counts so
// the caller can refresh useSyncStatus().

export async function syncAll(/* supabase */) {
  const db = await getDb()
  if (!db) return { synced: 0, remaining: 0 }
  // TODO(19b/19c): for each pending row, build the row to insert and call
  // supabase.from(<target>).insert(...). On success, markSynced.
  return { synced: 0, remaining: await getPendingCount() }
}

// Auto-sync on online: best-effort. The actual sync is the stub above
// until 19b/19c ship.
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
