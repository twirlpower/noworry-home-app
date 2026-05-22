import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const KPI_KEY = 'noworry-admin-kpi-snapshot'

const KPI_FIELDS = [
  ['paying_members', 'Paying members'],
  ['mrr', 'MRR ($)'],
  ['aware_accounts', 'Aware accounts'],
  ['vendors_signed', 'Vendors signed'],
  ['active_referral_partners', 'Active referral partners'],
  ['weekly_hours', 'Weekly hours logged'],
]

const EMPTY_KPI = {
  paying_members: '',
  mrr: '',
  aware_accounts: '',
  vendors_signed: '',
  active_referral_partners: '',
  weekly_hours: '',
}

const VENDOR_STATUSES = [
  ['prospect', 'Prospect'],
  ['onboarding', 'Onboarding'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
]

const SUB_TIERS = [
  ['aware', 'Aware'],
  ['prepared', 'Prepared'],
  ['covered', 'Covered'],
  ['complete', 'Complete'],
]

function loadKpi() {
  try {
    const raw = localStorage.getItem(KPI_KEY)
    if (!raw) return { values: EMPTY_KPI, savedAt: null }
    const parsed = JSON.parse(raw)
    return {
      values: { ...EMPTY_KPI, ...(parsed.values || {}) },
      savedAt: parsed.savedAt || null,
    }
  } catch {
    return { values: EMPTY_KPI, savedAt: null }
  }
}

export default function AdminReports() {
  const [circlesByTier, setCirclesByTier] = useState(null)
  const [vendorsByStatus, setVendorsByStatus] = useState(null)
  const [totalMrr, setTotalMrr] = useState(null)
  const [statusError, setStatusError] = useState('')

  // localStorage is synchronous — lazy initial state keeps reads out of an
  // effect (avoids the react-hooks/set-state-in-effect rule).
  const [kpi, setKpi] = useState(() => loadKpi().values)
  const [kpiSavedAt, setKpiSavedAt] = useState(() => loadKpi().savedAt)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('family_circles').select('subscription_tier'),
      supabase.from('vendors').select('status'),
      supabase.from('crm_contacts').select('mrr'),
    ]).then(([circlesRes, vendorsRes, contactsRes]) => {
      if (cancelled) return
      if (circlesRes.error || vendorsRes.error || contactsRes.error) {
        setStatusError(
          circlesRes.error?.message ||
            vendorsRes.error?.message ||
            contactsRes.error?.message ||
            'Failed to load platform status'
        )
      }
      const circlesCounts = {}
      for (const [v] of SUB_TIERS) circlesCounts[v] = 0
      for (const row of circlesRes.data ?? []) {
        const t = row.subscription_tier
        if (t in circlesCounts) circlesCounts[t] += 1
      }
      setCirclesByTier(circlesCounts)

      const vendorCounts = {}
      for (const [v] of VENDOR_STATUSES) vendorCounts[v] = 0
      for (const row of vendorsRes.data ?? []) {
        const s = row.status
        if (s in vendorCounts) vendorCounts[s] += 1
      }
      setVendorsByStatus(vendorCounts)

      const mrr = (contactsRes.data ?? []).reduce(
        (sum, c) => sum + Number(c.mrr || 0),
        0
      )
      setTotalMrr(mrr)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function setKpiField(key, val) {
    setKpi((k) => ({ ...k, [key]: val }))
  }

  function saveKpi() {
    const savedAt = new Date().toISOString()
    try {
      localStorage.setItem(KPI_KEY, JSON.stringify({ values: kpi, savedAt }))
      setKpiSavedAt(savedAt)
    } catch {
      // localStorage unavailable — fail silent on a founder-only tool
    }
  }

  return (
    <div className="page admin-page">
      <div className="admin-header">
        <h1>Reports &amp; Analytics</h1>
        <p className="admin-subtitle">Platform performance overview</p>
      </div>

      {/* Platform Status */}
      <section className="admin-section">
        <h2>Platform Status</h2>
        {statusError && <div className="auth-error" role="alert">{statusError}</div>}

        <div className="admin-status-grid">
          <div className="admin-status-card">
            <h3>Circles by tier</h3>
            {circlesByTier == null ? (
              <p className="admin-meta">Loading…</p>
            ) : (
              <ul className="admin-kv-list">
                {SUB_TIERS.map(([v, l]) => (
                  <li key={v}>
                    <span>{l}</span>
                    <strong>{circlesByTier[v] ?? 0}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-status-card">
            <h3>Vendors by status</h3>
            {vendorsByStatus == null ? (
              <p className="admin-meta">Loading…</p>
            ) : (
              <ul className="admin-kv-list">
                {VENDOR_STATUSES.map(([v, l]) => (
                  <li key={v}>
                    <span>{l}</span>
                    <strong>{vendorsByStatus[v] ?? 0}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-status-card">
            <h3>Total MRR</h3>
            <p className="admin-big-number">
              {totalMrr == null ? '…' : `$${totalMrr.toFixed(2)}`}
            </p>
            <p className="admin-meta">From crm_contacts.mrr</p>
          </div>
        </div>
      </section>

      {/* KPI Snapshot */}
      <section className="admin-section">
        <h2>KPI Snapshot</h2>
        <p className="admin-meta admin-section-sub">
          Weekly numbers. Stored locally on this device only.
        </p>
        <div className="admin-kpi-grid">
          {KPI_FIELDS.map(([key, label]) => (
            <label key={key} className="form-label">
              {label}
              <input
                type="number"
                step="0.01"
                value={kpi[key]}
                onChange={(e) => setKpiField(key, e.target.value)}
                className="form-input"
              />
            </label>
          ))}
        </div>
        <div className="admin-section-actions">
          <button type="button" className="btn-secondary" onClick={saveKpi}>
            Save snapshot
          </button>
          {kpiSavedAt && (
            <span className="admin-meta">
              Last saved {new Date(kpiSavedAt).toLocaleString()}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
