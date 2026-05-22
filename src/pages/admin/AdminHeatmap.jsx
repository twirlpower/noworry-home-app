import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

import { supabase } from '../../lib/supabase'
import {
  ZIP_CENTROIDS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  centroidFor,
} from '../../lib/zipCentroids'

// Privacy guard — any ZIP marker below this count has no popup. Aggregating
// at ZIP level already prevents single-member identification, but we belt-
// and-suspenders this so a single new ZIP doesn't expose tier+date.
const MIN_FOR_POPUP = 3

const TIERS = [
  ['aware', 'Aware', '#64B5F6'],
  ['prepared', 'Prepared', '#EF9F27'],
  ['covered', 'Covered', '#3B6D11'],
  ['complete', 'Complete', '#1B5E38'],
]
const TIER_COLOR = Object.fromEntries(TIERS.map(([k, , c]) => [k, c]))
const VENDOR_TIERS = new Set(['covered', 'complete'])

// Service-type filter values.
const SERVICE_FILTERS = [
  ['all', 'All'],
  ['digital', 'Digital only (Aware + Prepared)'],
  ['vendor', 'Vendor-served (Covered + Complete)'],
]

// Cluster icon: count + dominant-tier color. Returns an L.DivIcon. The
// dominant tier is the tier with the most members in the contained
// markers — pulled from each marker's options.tierKey.
function buildClusterIcon(cluster) {
  const children = cluster.getAllChildMarkers()
  const tally = {}
  for (const m of children) {
    const opts = m.options ?? {}
    const t = opts.tierKey ?? 'aware'
    tally[t] = (tally[t] ?? 0) + (opts.tierCount ?? 1)
  }
  let dom = 'aware'
  let domN = -1
  for (const [t, n] of Object.entries(tally)) {
    if (n > domN) { dom = t; domN = n }
  }
  const total = Object.values(tally).reduce((a, b) => a + b, 0)
  const bg = TIER_COLOR[dom] ?? '#888'
  return L.divIcon({
    html: `<div class="heat-cluster" style="background:${bg}"><span>${total}</span></div>`,
    className: 'heat-cluster-wrap',
    iconSize: [42, 42],
  })
}

// Child component: takes resolved markers and pushes them into a
// MarkerClusterGroup on the map. Cleanly removes the layer on unmount or
// when markers change.
function ZipMarkerLayer({ entries }) {
  const map = useMap()

  useEffect(() => {
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 60,
      iconCreateFunction: buildClusterIcon,
    })

    for (const e of entries) {
      const radius = Math.min(20, 6 + Math.log2(e.total + 1) * 2.5)
      const marker = L.circleMarker([e.lat, e.lng], {
        radius,
        color: '#fff',
        weight: 1,
        fillColor: TIER_COLOR[e.dominantTier] ?? '#888',
        fillOpacity: 0.85,
        // Tagged for the cluster icon's tally logic.
        tierKey: e.dominantTier,
        tierCount: e.total,
      })

      if (e.total >= MIN_FOR_POPUP) {
        const breakdown = TIERS
          .map(([k, label]) => {
            const n = e.byTier[k] ?? 0
            return n > 0 ? `<li>${n} ${label}</li>` : null
          })
          .filter(Boolean)
          .join('')
        marker.bindPopup(
          `<div class="heat-popup">` +
          `  <h4>${e.zip} · ${e.city ?? ''}</h4>` +
          `  <p class="heat-popup-total">${e.total} member${e.total === 1 ? '' : 's'}</p>` +
          `  <ul>${breakdown}</ul>` +
          `</div>`
        )
      }
      // count < MIN_FOR_POPUP: no popup binding — privacy guard.

      cluster.addLayer(marker)
    }

    map.addLayer(cluster)
    return () => {
      map.removeLayer(cluster)
    }
  }, [map, entries])

  return null
}

export default function AdminHeatmap() {
  // ZIP+tier rows from the SECURITY DEFINER RPC.
  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  // Filter state. Selected tiers as a Set for fast toggling.
  const [selectedTiers, setSelectedTiers] = useState(
    () => new Set(TIERS.map(([k]) => k))
  )
  const [serviceFilter, setServiceFilter] = useState('all')

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_member_zip_counts').then(({ data, error: e }) => {
      if (cancelled) return
      if (e) setError(e.message)
      else setRows(data ?? [])
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function toggleTier(t) {
    setSelectedTiers((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  function resetFilters() {
    setSelectedTiers(new Set(TIERS.map(([k]) => k)))
    setServiceFilter('all')
  }

  // Filtered rows → per-ZIP aggregates ready for the map.
  const entries = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (!selectedTiers.has(r.subscription_tier)) return false
      if (serviceFilter === 'digital' && VENDOR_TIERS.has(r.subscription_tier)) return false
      if (serviceFilter === 'vendor' && !VENDOR_TIERS.has(r.subscription_tier)) return false
      return true
    })

    // Group by ZIP → { total, byTier: {tier: count}, dominantTier }
    const map = new Map()
    for (const r of filtered) {
      const centroid = centroidFor(r.zip)
      if (!centroid) continue // unknown ZIP — skip rather than misplace
      const e = map.get(r.zip) ?? {
        zip: r.zip,
        city: centroid.city,
        lat: centroid.lat,
        lng: centroid.lng,
        total: 0,
        byTier: {},
        dominantTier: 'aware',
      }
      e.byTier[r.subscription_tier] = (e.byTier[r.subscription_tier] ?? 0) + r.member_count
      e.total += r.member_count
      map.set(r.zip, e)
    }
    // Compute dominant tier per ZIP.
    for (const e of map.values()) {
      let dom = 'aware'
      let domN = -1
      for (const [t, n] of Object.entries(e.byTier)) {
        if (n > domN) { dom = t; domN = n }
      }
      e.dominantTier = dom
    }
    return Array.from(map.values())
  }, [rows, selectedTiers, serviceFilter])

  // Stats sidebar totals (filtered set).
  const stats = useMemo(() => {
    const out = { total: 0, byTier: {} }
    for (const e of entries) {
      out.total += e.total
      for (const [t, n] of Object.entries(e.byTier)) {
        out.byTier[t] = (out.byTier[t] ?? 0) + n
      }
    }
    return out
  }, [entries])

  // Unknown-ZIP diagnostics — admin should know if some rows aren't mapped.
  const unknownZips = useMemo(() => {
    const seen = new Set()
    for (const r of rows) {
      if (!ZIP_CENTROIDS[r.zip]) seen.add(r.zip)
    }
    return Array.from(seen).sort()
  }, [rows])

  return (
    <div className="page admin-page heatmap-page">
      <div className="admin-header">
        <h1>Member Map</h1>
        <p className="admin-subtitle">
          ZIP-level coverage of Aware / Prepared / Covered / Complete members.
          Privacy-first — no names, no addresses, ZIP centroids only.
        </p>
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      <div className="heat-filter-bar">
        <div className="heat-filter-group">
          <span className="heat-filter-label">Tier</span>
          {TIERS.map(([k, l, c]) => {
            const on = selectedTiers.has(k)
            return (
              <button
                type="button"
                key={k}
                className={`heat-pill ${on ? 'heat-pill-on' : ''}`}
                onClick={() => toggleTier(k)}
                style={on ? { background: c, borderColor: c, color: '#fff' } : undefined}
                aria-pressed={on}
              >
                {l}
              </button>
            )
          })}
        </div>

        <div className="heat-filter-group">
          <span className="heat-filter-label">Service</span>
          {SERVICE_FILTERS.map(([k, l]) => (
            <button
              type="button"
              key={k}
              className={`heat-pill ${serviceFilter === k ? 'heat-pill-on' : ''}`}
              onClick={() => setServiceFilter(k)}
              aria-pressed={serviceFilter === k}
            >
              {l}
            </button>
          ))}
        </div>

        <button type="button" className="btn-link" onClick={resetFilters}>
          Reset filters
        </button>
      </div>

      <div className="heat-layout">
        <div className="heat-map-wrap">
          {!loaded ? (
            <p className="admin-meta">Loading member locations…</p>
          ) : (
            <MapContainer
              center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]}
              zoom={DEFAULT_ZOOM}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ZipMarkerLayer entries={entries} />
            </MapContainer>
          )}
        </div>

        <aside className="heat-sidebar">
          <h3>Filtered totals</h3>
          <Link to="/admin/members" className="heat-sidebar-total heat-sidebar-link">
            <strong>{stats.total.toLocaleString()}</strong> member{stats.total === 1 ? '' : 's'} shown →
          </Link>

          <ul className="heat-tier-bars">
            {TIERS.map(([k, l, c]) => {
              const n = stats.byTier[k] ?? 0
              const pct = stats.total > 0 ? (n / stats.total) * 100 : 0
              return (
                <li key={k}>
                  <Link to={`/admin/members?tier=${k}`} className="heat-tier-row heat-tier-link">
                    <span className="heat-tier-dot" style={{ background: c }} />
                    <span className="heat-tier-label">{l}</span>
                    <span className="heat-tier-count">{n}</span>
                  </Link>
                  <div className="heat-tier-bar">
                    <div
                      className="heat-tier-bar-fill"
                      style={{ width: `${pct}%`, background: c }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>

          <p className="heat-vendor-note">
            <strong>Vendor-served:</strong>{' '}
            {(stats.byTier.covered ?? 0) + (stats.byTier.complete ?? 0)} of {stats.total}
          </p>

          {unknownZips.length > 0 && (
            <div className="heat-warn">
              <h4>Unmapped ZIPs</h4>
              <p>
                {unknownZips.length} ZIP{unknownZips.length === 1 ? '' : 's'} not in the
                centroid lookup — members at those ZIPs aren't plotted.
              </p>
              <p className="admin-meta">{unknownZips.join(', ')}</p>
            </div>
          )}

          <p className="heat-privacy-note">
            Markers below {MIN_FOR_POPUP} members have no popup detail.
            Precise per-home geocoding is a future enhancement — today we
            plot ZIP centroids.
          </p>
        </aside>
      </div>
    </div>
  )
}
