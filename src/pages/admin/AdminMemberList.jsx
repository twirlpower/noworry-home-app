import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const MS_PER_DAY = 86400000

// Tier metadata. Order here is the toggle pill order in the filter bar.
const TIERS = [
  ['aware',    'Aware',    'blue'],
  ['prepared', 'Prepared', 'amber'],
  ['covered',  'Covered',  'green'],
  ['complete', 'Complete', 'dark-green'],
]
const TIER_LABEL = Object.fromEntries(TIERS.map(([k, l]) => [k, l]))
const TIER_COLOR = Object.fromEntries(TIERS.map(([k, , c]) => [k, c]))

const BILLING_OPTIONS = [
  ['',          'All billing'],
  ['trial',     'Trial'],
  ['active',    'Active'],
  ['past_due',  'Past Due'],
  ['canceled',  'Canceled'],
]
const BILLING_COLOR = {
  trial:    'amber',
  active:   'green',
  past_due: 'red',
  canceled: 'gray',
}
const BILLING_LABEL = {
  trial: 'Trial', active: 'Active', past_due: 'Past Due', canceled: 'Canceled',
}

function fmtMonthYear(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Build a display string for the "Trial · X days left" column. Returns
// { text, isUrgent } so the UI can flip color when ≤7 days remain.
function trialOrSince(row, nowMs) {
  if (row.billing_status === 'trial' && row.trial_ends_at) {
    const days = Math.ceil((new Date(row.trial_ends_at).getTime() - nowMs) / MS_PER_DAY)
    if (days <= 0) return { text: 'Trial · expired', isUrgent: true }
    return { text: `Trial · ${days} day${days === 1 ? '' : 's'} left`, isUrgent: days <= 7 }
  }
  return { text: `Since ${fmtMonthYear(row.created_at)}`, isUrgent: false }
}

export default function AdminMemberList() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  // Stable "now" — Date.now() in render trips the strict React-hooks rule.
  const [nowMs] = useState(() => Date.now())

  // Initial state pulled from URL params on mount. The page also writes
  // back to the URL when filters change so the view is linkable.
  const initialTiers = useMemo(() => {
    const t = params.getAll('tier')
    if (t.length) return new Set(t)
    const single = params.get('tier')
    return single ? new Set([single]) : new Set()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [tierFilter, setTierFilter]      = useState(initialTiers)
  const [billingFilter, setBillingFilter] = useState(() => params.get('billing') || '')
  const [zipFilter, setZipFilter]         = useState(() => params.get('zip') || '')
  const [search, setSearch]               = useState(() => params.get('q') || '')

  const [rows, setRows]   = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError]   = useState('')
  const [expandedKey, setExpandedKey] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .rpc('admin_list_members', { p_tier: null, p_zip: null, p_billing_status: null })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setRows(data ?? [])
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  // Mirror filter state back to the URL so the view is shareable. Use
  // replace so the back button stays useful.
  useEffect(() => {
    const next = new URLSearchParams()
    for (const t of tierFilter) next.append('tier', t)
    if (billingFilter) next.set('billing', billingFilter)
    if (zipFilter) next.set('zip', zipFilter)
    if (search) next.set('q', search)
    setParams(next, { replace: true })
  }, [tierFilter, billingFilter, zipFilter, search, setParams])

  function toggleTier(t) {
    setTierFilter((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  function resetFilters() {
    setTierFilter(new Set())
    setBillingFilter('')
    setZipFilter('')
    setSearch('')
  }

  const activeFilterCount =
    tierFilter.size +
    (billingFilter ? 1 : 0) +
    (zipFilter ? 1 : 0) +
    (search ? 1 : 0)

  // Apply all filters in one pass. Tier multi-select is set-membership;
  // search is case-insensitive name OR email substring.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const zip = zipFilter.trim()
    return rows.filter((r) => {
      if (tierFilter.size > 0 && !tierFilter.has(r.subscription_tier)) return false
      if (billingFilter && r.billing_status !== billingFilter) return false
      if (zip && r.zip !== zip) return false
      if (q) {
        const name = (r.member_name ?? '').toLowerCase()
        const email = (r.member_email ?? '').toLowerCase()
        if (!name.includes(q) && !email.includes(q)) return false
      }
      return true
    })
  }, [rows, tierFilter, billingFilter, zipFilter, search])

  const counts = useMemo(() => {
    const c = { total: visible.length, aware: 0, prepared: 0, vendor: 0 }
    for (const r of visible) {
      if (r.subscription_tier === 'aware') c.aware += 1
      else if (r.subscription_tier === 'prepared') c.prepared += 1
      else if (r.subscription_tier === 'covered' || r.subscription_tier === 'complete') c.vendor += 1
    }
    return c
  }, [visible])

  return (
    <div className="page admin-page">
      <div className="admin-header">
        <h1>Members</h1>
        <p className="admin-subtitle">All registered home circles</p>
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {/* Filter bar */}
      <section className="member-filter-bar">
        <div className="member-filter-group">
          <span className="member-filter-label">Tier</span>
          {TIERS.map(([k, l]) => {
            const on = tierFilter.has(k)
            return (
              <button
                key={k}
                type="button"
                className={`heat-pill ${on ? 'heat-pill-on' : ''}`}
                onClick={() => toggleTier(k)}
                aria-pressed={on}
                style={on ? { background: `var(--cool)`, borderColor: 'currentColor', color: `var(--deep)` } : undefined}
              >
                {l}
              </button>
            )
          })}
        </div>

        <label className="member-filter-field">
          <span className="member-filter-label">Billing</span>
          <select
            value={billingFilter}
            onChange={(e) => setBillingFilter(e.target.value)}
            className="form-input"
          >
            {BILLING_OPTIONS.map(([v, l]) => (
              <option key={v || 'all'} value={v}>{l}</option>
            ))}
          </select>
        </label>

        <label className="member-filter-field">
          <span className="member-filter-label">ZIP</span>
          <input
            type="text"
            value={zipFilter}
            onChange={(e) => setZipFilter(e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric"
            maxLength={5}
            className="form-input"
            placeholder="80012"
          />
        </label>

        <label className="member-filter-field member-filter-search">
          <span className="member-filter-label">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input"
            placeholder="Name or email"
          />
        </label>

        <button
          type="button"
          className="btn-link"
          onClick={resetFilters}
          disabled={activeFilterCount === 0}
        >
          Reset filters
          {activeFilterCount > 0 && (
            <span className="admin-pill admin-pill-color-amber" style={{ marginLeft: '0.4rem' }}>
              {activeFilterCount}
            </span>
          )}
        </button>
      </section>

      {/* Summary strip */}
      <div className="admin-stat-strip" style={{ marginBottom: '1rem' }}>
        <div className="admin-stat">
          <span className="admin-stat-value">{counts.total}</span>
          <span className="admin-stat-label">Total shown</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value" style={{ color: '#185FA5' }}>{counts.aware}</span>
          <span className="admin-stat-label">Aware</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value" style={{ color: 'var(--amber-text)' }}>{counts.prepared}</span>
          <span className="admin-stat-label">Prepared</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value" style={{ color: 'var(--deep)' }}>{counts.vendor}</span>
          <span className="admin-stat-label">Covered + Complete</span>
        </div>
      </div>

      {/* Table */}
      {!loaded ? (
        <p className="admin-meta">Loading members…</p>
      ) : visible.length === 0 ? (
        <p className="page-placeholder">
          No members match your filters.{' '}
          <button type="button" className="btn-link" onClick={resetFilters}>
            Reset filters
          </button>
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Tier</th>
                <th>Billing</th>
                <th>Trial / Member Since</th>
                <th>ZIP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                // A single (circle, person) is the row identity. Two people
                // in the same circle each get their own row + their own key.
                const key = `${r.circle_id}:${r.member_email ?? 'noemail'}`
                const open = expandedKey === key
                const trial = trialOrSince(r, nowMs)
                const tierColor = TIER_COLOR[r.subscription_tier] ?? 'gray'
                const billColor = BILLING_COLOR[r.billing_status] ?? 'gray'
                const billLabel = BILLING_LABEL[r.billing_status] ?? (r.billing_status ?? '—')
                return (
                  <Fragment key={key}>
                    <tr
                      className={open ? 'admin-row-open' : ''}
                      onClick={() => setExpandedKey(open ? null : key)}
                    >
                      <td><strong>{r.member_name || '(no name)'}</strong></td>
                      <td>{r.member_email || '—'}</td>
                      <td>
                        <span className={`admin-pill admin-pill-color-${tierColor}`}>
                          {TIER_LABEL[r.subscription_tier] ?? r.subscription_tier ?? '—'}
                        </span>
                      </td>
                      <td>
                        {r.billing_status
                          ? <span className={`admin-pill admin-pill-color-${billColor}`}>{billLabel}</span>
                          : <span className="admin-meta">—</span>}
                      </td>
                      <td className={trial.isUrgent ? 'task-due-overdue' : ''}>
                        {trial.text}
                      </td>
                      <td>{r.zip || '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate('/admin/crm')
                          }}
                        >
                          Manage →
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="admin-row-expand">
                        <td colSpan={7}>
                          <div className="admin-expand-body" onClick={(e) => e.stopPropagation()}>
                            <div className="admin-expand-grid">
                              <div>
                                <strong>Circle ID:</strong>{' '}
                                <code className="admin-meta">{r.circle_id}</code>
                              </div>
                              <div>
                                <strong>Home ID:</strong>{' '}
                                {r.home_id ? <code className="admin-meta">{r.home_id}</code> : <em className="admin-meta">—</em>}
                              </div>
                              <div className="admin-expand-grid-full">
                                <strong>Address:</strong>{' '}
                                {r.address_line1
                                  ? [r.address_line1, r.address_line2, r.city, r.zip]
                                      .filter(Boolean).join(', ')
                                  : <em className="admin-meta">Not on file</em>}
                              </div>
                              <div>
                                <strong>Circle created:</strong>{' '}
                                {fmtDate(r.created_at)}
                              </div>
                              <div>
                                <strong>Trial ends:</strong>{' '}
                                {r.trial_ends_at ? fmtDate(r.trial_ends_at) : <em className="admin-meta">N/A</em>}
                              </div>
                            </div>
                            <Link to="/admin/crm" className="btn-link">
                              View in CRM →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
