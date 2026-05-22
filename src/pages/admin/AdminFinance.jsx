import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Helper: pull the caller's access token for the Authorization header on
// the api/stripe/get-* routes (each verifies staff role server-side).
async function bearer() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? ''
}

const TXN_STATUS_PILL = {
  succeeded:      { label: 'Succeeded',     color: 'green' },
  failed:         { label: 'Failed',        color: 'red' },
  refunded:       { label: 'Refunded',      color: 'amber' },
  partial_refund: { label: 'Partial refund', color: 'amber' },
  pending:        { label: 'Pending',       color: 'gray' },
}

function money(n) {
  if (n == null || isNaN(n)) return '—'
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtUnixDate(secs) {
  if (!secs) return '—'
  return new Date(secs * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtIsoDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function AdminFinance() {
  const [summary, setSummary] = useState(null)
  const [summaryErr, setSummaryErr] = useState('')

  const [promotionCodes, setPromotionCodes] = useState([])
  const [couponsErr, setCouponsErr] = useState('')

  const [redemptions, setRedemptions] = useState([])
  const [redemptionsErr, setRedemptionsErr] = useState('')

  const [charges, setCharges] = useState([])
  const [chargesErr, setChargesErr] = useState('')

  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const token = await bearer()
      const headers = { Authorization: `Bearer ${token}` }

      const [sumRes, couponsRes, txnRes, redempRes] = await Promise.all([
        fetch('/api/stripe/get-finance-summary', { headers })
          .then((r) => r.json().then((j) => ({ status: r.status, json: j })))
          .catch((e) => ({ status: 0, json: { error: e?.message } })),
        fetch('/api/stripe/get-coupons', { headers })
          .then((r) => r.json().then((j) => ({ status: r.status, json: j })))
          .catch((e) => ({ status: 0, json: { error: e?.message } })),
        fetch('/api/stripe/get-transactions', { headers })
          .then((r) => r.json().then((j) => ({ status: r.status, json: j })))
          .catch((e) => ({ status: 0, json: { error: e?.message } })),
        supabase
          .from('promo_redemptions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      if (cancelled) return

      if (sumRes.status === 200) setSummary(sumRes.json)
      else setSummaryErr(sumRes.json?.detail || sumRes.json?.error || 'Failed to load summary')

      if (couponsRes.status === 200) setPromotionCodes(couponsRes.json?.promotionCodes ?? [])
      else setCouponsErr(couponsRes.json?.detail || couponsRes.json?.error || 'Failed to load promo codes')

      if (txnRes.status === 200) setCharges(txnRes.json?.charges ?? [])
      else setChargesErr(txnRes.json?.detail || txnRes.json?.error || 'Failed to load transactions')

      if (redempRes.error) setRedemptionsErr(redempRes.error.message)
      else setRedemptions(redempRes.data ?? [])

      setLoaded(true)
    }

    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="page admin-page">
      <div className="admin-header">
        <h1>Finance</h1>
        <p className="admin-subtitle">Revenue and payment overview</p>
      </div>

      {/* ── Section 1: Revenue Summary ─────────────────────────────────── */}
      <section className="admin-section">
        <h2>Revenue Summary</h2>
        {summaryErr && <div className="auth-error" role="alert">{summaryErr}</div>}
        <div className="admin-stat-strip" style={{ marginTop: '0.6rem' }}>
          <FinStat
            label="MRR"
            value={summary == null ? null : money(summary.mrr)}
            tone="good"
          />
          <FinStat
            label="Active Subscribers"
            value={summary?.activeSubscribers ?? null}
          />
          <FinStat
            label="Revenue This Month"
            value={summary == null ? null : money(summary.revenueThisMonth)}
          />
          <FinStat
            label="vs Last Month"
            value={summary == null
              ? null
              : (summary.momChange == null
                ? '—'
                : `${summary.momChange >= 0 ? '+' : ''}${summary.momChange.toFixed(1)}% ${summary.momChange >= 0 ? '↑' : '↓'}`)}
            tone={summary == null || summary.momChange == null
              ? 'neutral'
              : summary.momChange >= 0 ? 'good' : 'danger'}
          />
        </div>
        {summary?.revenueLastMonth != null && (
          <p className="admin-meta" style={{ marginTop: '0.6rem' }}>
            Last month: {money(summary.revenueLastMonth)}
          </p>
        )}
      </section>

      {/* ── Section 2: Coupon Usage ────────────────────────────────────── */}
      <section className="admin-section">
        <h2>Promo Codes</h2>
        <div className="finance-promo-grid">
          <div>
            <h3 className="finance-subhead">Available codes</h3>
            {couponsErr && <div className="auth-error" role="alert">{couponsErr}</div>}
            {!loaded ? (
              <p className="admin-meta">Loading…</p>
            ) : promotionCodes.length === 0 ? (
              <p className="page-placeholder">No promo codes yet. Create one in Stripe Dashboard → Coupons → Promotion Codes.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Code</th><th>Discount</th><th>Duration</th><th>Redeemed</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promotionCodes.map((p) => (
                      <tr key={p.id}>
                        <td><strong>{p.code}</strong></td>
                        <td>{p.discount}</td>
                        <td>
                          {p.duration === 'forever' ? 'Forever'
                            : p.duration === 'repeating' ? `${p.durationMonths} months`
                            : p.duration === 'once' ? 'Once'
                            : '—'}
                        </td>
                        <td>{p.timesRedeemed}{p.maxRedemptions ? ` / ${p.maxRedemptions}` : ''}</td>
                        <td>
                          <span className={`admin-pill admin-pill-color-${p.active ? 'green' : 'gray'}`}>
                            {p.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="finance-subhead">Redemption log</h3>
            {redemptionsErr && <div className="auth-error" role="alert">{redemptionsErr}</div>}
            {!loaded ? (
              <p className="admin-meta">Loading…</p>
            ) : redemptions.length === 0 ? (
              <p className="page-placeholder">No promo codes used yet</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr><th>Code</th><th>Discount</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {redemptions.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.coupon_code}</strong></td>
                        <td className="admin-cell-truncate">{r.discount_description || '—'}</td>
                        <td>{fmtIsoDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Section 3: Recent Transactions ─────────────────────────────── */}
      <section className="admin-section">
        <h2>Recent Transactions</h2>
        {chargesErr && <div className="auth-error" role="alert">{chargesErr}</div>}
        {!loaded ? (
          <p className="admin-meta">Loading…</p>
        ) : charges.length === 0 ? (
          <p className="page-placeholder">No transactions yet.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th><th>Customer</th><th>Amount</th>
                  <th>Status</th><th>Description</th><th></th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => {
                  const meta = TXN_STATUS_PILL[c.status] ?? { label: c.status, color: 'gray' }
                  return (
                    <tr key={c.id}>
                      <td>{fmtUnixDate(c.date)}</td>
                      <td>{c.customerEmail}</td>
                      <td>{money(c.amount)}{c.amountRefunded > 0 && c.status !== 'refunded' && <span className="admin-meta"> (−{money(c.amountRefunded)})</span>}</td>
                      <td>
                        <span className={`admin-pill admin-pill-color-${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="admin-cell-truncate">{c.description || '—'}</td>
                      <td>
                        <a href={c.stripeUrl} target="_blank" rel="noreferrer" aria-label="Open in Stripe Dashboard">↗</a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section 4: Coming Soon ─────────────────────────────────────── */}
      <section className="admin-section">
        <h2>Coming Soon</h2>
        <div className="finance-coming-soon-grid">
          <div className="finance-soon-card">
            <h3>Vendor Payout Schedule</h3>
            <p>Track and schedule vendor payments from a single view.</p>
            <span className="admin-pill admin-pill-color-gray">Coming Soon</span>
          </div>
          <div className="finance-soon-card">
            <h3>Tax Summary</h3>
            <p>Annual revenue summary and 1099 preparation support.</p>
            <span className="admin-pill admin-pill-color-gray">Coming Soon</span>
          </div>
          <div className="finance-soon-card">
            <h3>Refund History</h3>
            <p>Track all refunds and customer credits.</p>
            <span className="admin-pill admin-pill-color-gray">Coming Soon</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function FinStat({ label, value, tone = 'neutral' }) {
  const cls = `admin-stat${
    tone === 'good'    ? ' admin-stat-good'
    : tone === 'warn'  ? ' admin-stat-warn'
    : tone === 'danger' ? ' admin-stat-danger'
    : ''
  }`
  return (
    <div className={cls}>
      <span className="admin-stat-value">{value == null ? '…' : value}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  )
}
