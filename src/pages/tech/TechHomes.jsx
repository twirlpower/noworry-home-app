import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { cacheHomes, getCachedHomes } from '../../lib/techSync'

const SYSTEM_LABELS = {
  furnace: 'Furnace',
  ac: 'Air Conditioning',
  water_heater: 'Water Heater',
  electrical_panel: 'Electrical Panel',
  washer: 'Washer',
  dryer: 'Dryer',
  refrigerator: 'Refrigerator',
  dishwasher: 'Dishwasher',
  sump_pump: 'Sump Pump',
  sprinkler_controller: 'Sprinkler Controller',
  hvac: 'HVAC',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  appliance: 'Appliance',
  other: 'Other',
}

// Single component for both the list (/tech/homes) and the detail
// (/tech/homes/:circleId). useParams() decides which view to render —
// keeps the route count down per spec.

const TIER_LABEL = { covered: 'Covered', complete: 'Complete' }

function fmtPhone(p) {
  if (!p) return ''
  const digits = String(p).replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return p
}

function fmtVisitDate(d) {
  if (!d) return 'No visits yet'
  const date = new Date(d)
  if (isNaN(date.getTime())) return 'No visits yet'
  return `Last visit: ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export default function TechHomes() {
  const { circleId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const flash = location.state?.flash ?? null

  const [homes, setHomes] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  // Detail-view-only state: systems for the open home + assessment status
  // pulled from homes table (since the RPC's assessment_complete is a
  // placeholder false — see migration 034 comment).
  const [detailSystems, setDetailSystems] = useState([])
  const [detailComplete, setDetailComplete] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Network first. On success, write through to the IndexedDB cache
      // so offline reloads work. On failure, fall back to whatever is
      // cached.
      const { data, error: e } = await supabase.rpc('tech_list_homes', {
        p_market: 'aurora',
      })
      if (cancelled) return

      if (!e && data) {
        setHomes(data)
        setFromCache(false)
        setLoaded(true)
        // Best-effort cache write — failure here is silent.
        cacheHomes(data).catch(() => {})
        return
      }

      // Network/RPC failed → try the cache.
      try {
        const cached = await getCachedHomes()
        if (!cancelled) {
          setHomes(cached)
          setFromCache(true)
          if (cached.length === 0) {
            setError(e?.message || 'Could not load homes and no cache available.')
          }
        }
      } catch (cacheErr) {
        if (!cancelled) setError(e?.message || cacheErr?.message || 'Failed to load homes.')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // Detail-view fetch: home_id + assessment_complete + home_systems rows.
  // Stays as-is on /tech/homes (no circleId) — the list view doesn't read
  // detailSystems/detailComplete, so leaving stale values is harmless.
  useEffect(() => {
    if (!circleId) return
    let cancelled = false
    async function loadDetail() {
      const { data: ch } = await supabase
        .from('circle_homes')
        .select('home_id, homes(assessment_complete)')
        .eq('circle_id', circleId)
        .eq('status', 'active')
        .eq('is_primary', true)
        .maybeSingle()
      if (cancelled || !ch?.home_id) return
      setDetailComplete(!!ch.homes?.assessment_complete)
      const { data: sys } = await supabase
        .from('home_systems')
        .select('id, system_type, manufacturer, model_number, install_year, filter_size, location_notes, condition_notes, brand, model, location_in_home, notes, install_date, is_active, active')
        .eq('home_id', ch.home_id)
        .order('system_type')
      if (cancelled) return
      // Filter to assessment-era rows: either `active` is true, or fall
      // back to legacy `is_active` true (handles pre-035 rows too).
      const visible = (sys ?? []).filter((s) => s.active !== false && s.is_active !== false)
      setDetailSystems(visible)
    }
    loadDetail()
    return () => { cancelled = true }
  }, [circleId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return homes
    return homes.filter((h) => {
      const fields = [h.address_line1, h.city, h.zip, h.member_name]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
      return fields.some((f) => f.includes(q))
    })
  }, [homes, search])

  // ── Detail view ───────────────────────────────────────────────────────
  if (circleId) {
    const home = homes.find((h) => h.circle_id === circleId)
    if (!loaded) {
      return <div className="tech-page"><p className="tech-meta">Loading…</p></div>
    }
    if (!home) {
      return (
        <div className="tech-page">
          <p className="tech-meta">Home not found in the current list.</p>
          <Link to="/tech/homes" className="tech-btn-secondary">← Back to Homes</Link>
        </div>
      )
    }

    const phoneDigits = home.member_phone ? String(home.member_phone).replace(/\D/g, '') : ''

    return (
      <div className="tech-page">
        <button
          type="button"
          className="tech-back-link"
          onClick={() => navigate('/tech/homes')}
        >
          ← Homes
        </button>

        {flash && (
          <div className="tech-banner tech-banner-good" role="status">
            {flash}
          </div>
        )}

        <h1 className="tech-h1">{home.address_line1 || '(no street address)'}</h1>
        <p className="tech-subtle">
          {[home.city, home.zip].filter(Boolean).join(', ')}
        </p>

        <div className="tech-detail-block">
          <div className="tech-detail-row">
            <span className="tech-detail-label">Member</span>
            <span>{home.member_name || '—'}</span>
          </div>
          {phoneDigits && (
            <div className="tech-detail-row">
              <span className="tech-detail-label">Phone</span>
              <a href={`tel:${phoneDigits}`} className="tech-link">
                {fmtPhone(home.member_phone)}
              </a>
            </div>
          )}
          <div className="tech-detail-row">
            <span className="tech-detail-label">Tier</span>
            <span className="tech-status-pill tech-status-green">
              {TIER_LABEL[home.subscription_tier] ?? home.subscription_tier}
            </span>
          </div>
          <div className="tech-detail-row">
            <span className="tech-detail-label">Circle ID</span>
            <code className="tech-meta">{home.circle_id}</code>
          </div>
        </div>

        {detailComplete ? (
          <div className="tech-banner tech-banner-good">
            ✓ Welcome Home Assessment complete
          </div>
        ) : (
          <div className="tech-banner tech-banner-warn">
            Welcome Home Assessment needed
            <Link to={`/tech/assess/${home.circle_id}`} className="tech-btn-primary">
              Start Assessment →
            </Link>
          </div>
        )}

        {detailComplete && detailSystems.length > 0 && (
          <>
            <h2 className="tech-h2">Home Systems</h2>
            <ul className="tech-system-list">
              {detailSystems.map((s) => {
                const manufacturer = s.manufacturer ?? s.brand ?? null
                const modelNumber = s.model_number ?? s.model ?? null
                const installYear = s.install_year ?? (s.install_date ? new Date(s.install_date).getFullYear() : null)
                const location = s.location_notes ?? s.location_in_home ?? null
                const condition = s.condition_notes ?? null
                return (
                  <li key={s.id} className="tech-system-row">
                    <div className="tech-system-head">
                      <strong>{SYSTEM_LABELS[s.system_type] ?? s.system_type}</strong>
                      {installYear && <span className="tech-meta"> · {installYear}</span>}
                    </div>
                    <div className="tech-system-meta">
                      {[manufacturer, modelNumber].filter(Boolean).join(' ') || <span className="tech-meta">No details</span>}
                    </div>
                    {s.filter_size && (
                      <div className="tech-meta">Filter: <strong>{s.filter_size}</strong></div>
                    )}
                    {location && <div className="tech-meta">📍 {location}</div>}
                    {condition && (
                      <div className="tech-system-condition">⚠ {condition}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <h2 className="tech-h2">Visit history</h2>
        <p className="tech-meta">No visits yet</p>

        <Link to={`/tech/checklist/${home.circle_id}`} className="tech-btn-primary">
          Start Quarterly Checklist →
        </Link>
      </div>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────
  return (
    <div className="tech-page">
      <h1 className="tech-h1">Your Homes</h1>
      <p className="tech-subtle">
        {homes.length} home{homes.length === 1 ? '' : 's'} in your area
        {fromCache && ' · showing cached data'}
      </p>

      {error && <div className="tech-banner tech-banner-danger" role="alert">{error}</div>}

      <input
        type="search"
        className="tech-search"
        placeholder="Search by address or name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {!loaded ? (
        <p className="tech-meta">Loading homes…</p>
      ) : filtered.length === 0 ? (
        <p className="tech-meta">
          {homes.length === 0 ? 'No homes yet.' : 'No homes match your search.'}
        </p>
      ) : (
        <ul className="tech-home-list">
          {filtered.map((h) => (
            <li key={h.circle_id}>
              <Link to={`/tech/homes/${h.circle_id}`} className="tech-home-card">
                <div className="tech-home-card-main">
                  <strong className="tech-home-card-address">
                    {h.address_line1 || '(no street address)'}
                  </strong>
                  <span className="tech-meta">
                    {[h.city, h.zip].filter(Boolean).join(', ')}
                  </span>
                  {h.member_name && (
                    <span className="tech-meta">{h.member_name}</span>
                  )}
                  <span className="tech-home-card-status">
                    <span className="tech-status-pill tech-status-green">
                      {TIER_LABEL[h.subscription_tier] ?? h.subscription_tier}
                    </span>
                    <span className="tech-meta">{fmtVisitDate(h.last_visit_date)}</span>
                  </span>
                </div>
                <span className="tech-home-card-arrow" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
