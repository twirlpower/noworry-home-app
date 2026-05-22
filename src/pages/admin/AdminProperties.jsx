import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const MS_PER_DAY = 86400000
const CURRENT_DAYS = 365            // < 1yr → current
const REFRESH_SOON_DAYS = 365 * 3   // 1-3yr → refresh soon

// Status classification by age of last_refreshed_at.
function statusFor(zip, nowMs) {
  if (!zip.last_refreshed_at) return 'none'
  const ageDays = (nowMs - new Date(zip.last_refreshed_at).getTime()) / MS_PER_DAY
  if (ageDays < CURRENT_DAYS) return 'current'
  if (ageDays < REFRESH_SOON_DAYS) return 'soon'
  return 'critical'
}

const STATUS_META = {
  current:  { label: 'Current',       pill: 'good',    short: '<1yr' },
  soon:     { label: 'Refresh Soon',  pill: 'warn',    short: '1-3yr' },
  critical: { label: 'Needs Refresh', pill: 'danger',  short: '3yr+' },
  none:     { label: 'No Data',       pill: 'neutral', short: 'never' },
}

const STATUS_FILTERS = [
  ['all', 'All statuses'],
  ['current', 'Current'],
  ['soon', 'Refresh Soon'],
  ['critical', 'Needs Refresh'],
  ['none', 'No Data'],
  ['flagged', 'Flagged for refresh'],
]

// Sort priority: critical first, then none, soon, current. Within a status,
// oldest last_refreshed_at first (NULL counts as oldest).
const STATUS_SORT_ORDER = { critical: 0, none: 1, soon: 2, current: 3 }

function fmtAge(zip, nowMs) {
  if (!zip.last_refreshed_at) return 'never'
  const days = (nowMs - new Date(zip.last_refreshed_at).getTime()) / MS_PER_DAY
  if (days < 30) return `${Math.max(0, Math.round(days))}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${(days / 365).toFixed(1)}yr`
}

function fmtRefreshDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const EMPTY_FORM = { zip: '', city: '', state: '', notes: '' }

export default function AdminProperties() {
  const [zips, setZips] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Stable "now" — lazy init keeps Date.now() out of render per the strict
  // hooks ruleset (see memory/lint-baseline.md).
  const [nowMs] = useState(() => Date.now())

  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [flaggingZip, setFlaggingZip] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('zip_refresh_status')
      .select('*')
      .order('zip')
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setZips(data ?? [])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    const { data, error: e } = await supabase
      .from('zip_refresh_status')
      .select('*')
      .order('zip')
    if (e) setError(e.message)
    else setZips(data ?? [])
  }

  // Derived: classify each ZIP, then count by status for the strip.
  const annotated = useMemo(
    () => zips.map((z) => ({ ...z, _status: statusFor(z, nowMs) })),
    [zips, nowMs]
  )

  const counts = useMemo(() => {
    const c = { total: annotated.length, current: 0, soon: 0, critical: 0, none: 0 }
    for (const z of annotated) c[z._status] += 1
    return c
  }, [annotated])

  // Filter + search + sort pipeline.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return annotated
      .filter((z) => {
        if (filter === 'flagged') return z.refresh_flagged === true
        if (filter === 'all') return true
        return z._status === filter
      })
      .filter((z) => {
        if (!q) return true
        return (
          z.zip?.toLowerCase().includes(q) ||
          z.city?.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const sa = STATUS_SORT_ORDER[a._status] ?? 9
        const sb = STATUS_SORT_ORDER[b._status] ?? 9
        if (sa !== sb) return sa - sb
        // within status: oldest last_refreshed_at first (NULL first)
        const ta = a.last_refreshed_at ? new Date(a.last_refreshed_at).getTime() : 0
        const tb = b.last_refreshed_at ? new Date(b.last_refreshed_at).getTime() : 0
        return ta - tb
      })
  }, [annotated, filter, search])

  async function flagForRefresh(z) {
    setFlaggingZip(z.zip)
    setError('')
    const next = !z.refresh_flagged
    const { error: e } = await supabase
      .from('zip_refresh_status')
      .update({ refresh_flagged: next })
      .eq('zip', z.zip)
    setFlaggingZip(null)
    if (e) {
      setError(e.message)
      return
    }
    // Local patch — avoid re-fetching the whole list.
    setZips((prev) =>
      prev.map((row) => (row.zip === z.zip ? { ...row, refresh_flagged: next } : row))
    )
  }

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleAdd(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')

    const zip = form.zip.trim()
    if (!/^\d{5}$/.test(zip)) {
      setError('ZIP must be 5 digits.')
      setSaving(false)
      return
    }
    const state = form.state.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(state)) {
      setError('State must be a 2-letter code.')
      setSaving(false)
      return
    }

    const payload = {
      zip,
      city: form.city.trim() || null,
      state,
      notes: form.notes.trim() || null,
      property_count: 0,
      refresh_flagged: true, // adding a new ZIP flags it for the next batch
    }

    const { error: e2 } = await supabase
      .from('zip_refresh_status')
      .insert(payload)
    setSaving(false)
    if (e2) {
      if (e2.code === '23505') {
        setError(`ZIP ${zip} is already in the database.`)
      } else {
        setError(e2.message)
      }
      return
    }
    setForm(EMPTY_FORM)
    setNotice(`Added ZIP ${zip} — flagged for next refresh batch.`)
    await reload()
  }

  return (
    <div className="page admin-page">
      <div className="admin-header">
        <h1>Properties</h1>
        <p className="admin-subtitle">ZIP-level coverage and refresh tracking</p>
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}

      {/* Section 1 — ZIP monitor */}
      <section className="admin-section">
        <h2>ZIP Code Monitor</h2>

        <div className="admin-stat-strip" style={{ marginTop: '0.6rem' }}>
          <PropStat label="Total ZIPs"        value={counts.total}    tone="neutral" />
          <PropStat label="Current"           value={counts.current}  tone={counts.current > 0 ? 'good' : 'neutral'} />
          <PropStat label="Refresh Soon"      value={counts.soon}     tone={counts.soon > 0 ? 'warn' : 'neutral'} />
          <PropStat label="Needs Refresh"     value={counts.critical} tone={counts.critical > 0 ? 'danger' : 'neutral'} />
          <PropStat label="No Data"           value={counts.none}     tone="neutral" />
        </div>

        <div className="prop-filter-row">
          <label className="form-label" style={{ flex: 1 }}>
            Search ZIP or city
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input"
              placeholder="80012, Aurora, …"
            />
          </label>
          <label className="form-label">
            Filter
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="form-input"
            >
              {STATUS_FILTERS.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </label>
        </div>

        {!loaded ? (
          <p className="admin-meta">Loading ZIP data…</p>
        ) : visible.length === 0 ? (
          <p className="page-placeholder">
            {zips.length === 0
              ? 'No ZIP data yet. Add one below or wait for the first refresh batch.'
              : 'No ZIPs match the current filter and search.'}
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ZIP</th>
                  <th>City</th>
                  <th>State</th>
                  <th>Properties</th>
                  <th>Last Updated</th>
                  <th>Age</th>
                  <th>Status</th>
                  <th>Flagged</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((z) => {
                  const meta = STATUS_META[z._status]
                  return (
                    <tr key={z.zip}>
                      <td><strong>{z.zip}</strong></td>
                      <td>{z.city || '—'}</td>
                      <td>{z.state || '—'}</td>
                      <td>{(z.property_count ?? 0).toLocaleString()}</td>
                      <td>{fmtRefreshDate(z.last_refreshed_at)}</td>
                      <td className="admin-meta">{fmtAge(z, nowMs)}</td>
                      <td>
                        <span className={`admin-pill prop-pill-${meta.pill}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        {z.refresh_flagged ? (
                          <span className="admin-pill prop-pill-warn">Flagged</span>
                        ) : (
                          <span className="admin-meta">—</span>
                        )}
                      </td>
                      <td>
                        <div className="prop-actions">
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => flagForRefresh(z)}
                            disabled={flaggingZip === z.zip}
                          >
                            {flaggingZip === z.zip
                              ? '…'
                              : z.refresh_flagged
                                ? 'Unflag'
                                : 'Flag for Refresh'}
                          </button>
                          <Link to={`/admin/members?zip=${z.zip}`} className="btn-link">
                            View Homes
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 2 — Add ZIP */}
      <section className="admin-section">
        <h2>Add ZIP Code</h2>
        <p className="admin-meta admin-section-sub">
          Adding a ZIP doesn't populate property data — it flags the ZIP for
          the next refresh batch.
        </p>
        <form onSubmit={handleAdd}>
          <div className="form-row form-row-3">
            <label className="form-label">
              ZIP code
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={form.zip}
                onChange={(e) => setField('zip', e.target.value.replace(/\D/g, ''))}
                required
                className="form-input"
                placeholder="80012"
              />
            </label>
            <label className="form-label">
              City
              <input
                type="text"
                value={form.city}
                onChange={(e) => setField('city', e.target.value)}
                required
                className="form-input"
                placeholder="Aurora"
              />
            </label>
            <label className="form-label">
              State
              <input
                type="text"
                maxLength={2}
                value={form.state}
                onChange={(e) => setField('state', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                required
                className="form-input"
                placeholder="CO"
              />
            </label>
          </div>
          <label className="form-label">
            Notes (optional)
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className="form-input"
              placeholder="Why this ZIP, source, anything to remember"
            />
          </label>
          <button
            type="submit"
            className="btn-secondary"
            disabled={saving || !form.zip || !form.city || !form.state}
          >
            {saving ? 'Adding…' : 'Add ZIP'}
          </button>
        </form>
      </section>

      {/* Roadmap placeholder */}
      <section className="admin-section prop-map-placeholder">
        <h2>ZIP Coverage Map — Coming Soon</h2>
        <p>
          A full US map showing database coverage by ZIP code will be
          available in a future update.
        </p>
      </section>
    </div>
  )
}

function PropStat({ label, value, tone }) {
  return (
    <div className={`admin-stat prop-stat-${tone}`}>
      <span className="admin-stat-value">{value == null ? '…' : value}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  )
}
