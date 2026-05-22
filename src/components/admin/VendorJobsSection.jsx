import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Service type / payout method / job status maps. Tuples for ordered render;
// derived label lookups via Object.fromEntries.
const SERVICE_TYPES = [
  ['hvac_tuneup', 'HVAC Tune-up'],
  ['gutter_cleaning', 'Gutter Cleaning'],
  ['water_heater_flush', 'Water Heater Flush'],
  ['filter_change', 'Filter Change'],
  ['safety_walkthrough', 'Safety Walkthrough'],
  ['seasonal_walkthrough', 'Seasonal Walkthrough'],
  ['quarterly_visit', 'Quarterly Visit'],
  ['handyman', 'Handyman'],
  ['sprinkler_activation', 'Sprinkler Activation'],
  ['sprinkler_winterize', 'Sprinkler Winterize'],
  ['repair_track1', 'Repair (Track 1)'],
  ['repair_track2', 'Repair (Track 2)'],
  ['other', 'Other'],
]
const SERVICE_LABEL = Object.fromEntries(SERVICE_TYPES)

const PAYOUT_METHODS = [
  ['check', 'Check'],
  ['zelle', 'Zelle'],
  ['ach', 'ACH'],
  ['other', 'Other'],
]

const JOB_STATUSES = [
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['disputed', 'Disputed'],
]
const JOB_STATUS_LABEL = Object.fromEntries(JOB_STATUSES)

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY_LOG_FORM = {
  job_date: '',
  service_type: 'hvac_tuneup',
  description: '',
  member_charge: '',
  vendor_rate: '',
  circle_id: '',
  notes: '',
  job_status: 'completed',
}

function money(n) {
  const v = Number(n ?? 0)
  return `$${v.toFixed(2)}`
}

function fmtJobDate(s) {
  if (!s) return '—'
  return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtPayoutDate(s) {
  if (!s) return ''
  return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function VendorJobsSection({ vendorId, onChange }) {
  const [jobs, setJobs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  // Log Job slide-in.
  const [logOpen, setLogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_LOG_FORM)
  const [saving, setSaving] = useState(false)

  // Inline Mark Paid expansion (per job row).
  const [payingId, setPayingId] = useState(null)
  const [payForm, setPayForm] = useState({
    payout_method: 'check',
    payout_date: '',
    payout_reference: '',
  })
  const [payingSaving, setPayingSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('vendor_jobs')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('job_date', { ascending: false })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setJobs(data ?? [])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [vendorId])

  // Derived summary from local jobs array — refresh after every insert/update.
  const totalJobs = jobs.length
  const totalBilled = jobs.reduce((s, j) => s + Number(j.member_charge || 0), 0)
  const totalPaidOut = jobs
    .filter((j) => j.payout_status === 'paid')
    .reduce((s, j) => s + Number(j.vendor_rate || 0), 0)
  const pendingPayout = jobs
    .filter((j) => j.payout_status === 'pending')
    .reduce((s, j) => s + Number(j.vendor_rate || 0), 0)
  const totalMargin = jobs.reduce((s, j) => s + Number(j.noworry_margin || 0), 0)

  function openLog() {
    setForm({ ...EMPTY_LOG_FORM, job_date: todayIso() })
    setError('')
    setLogOpen(true)
  }

  function closeLog() {
    setLogOpen(false)
    setError('')
  }

  function setField(key, val) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  async function handleLog(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      vendor_id: vendorId,
      circle_id: form.circle_id.trim() || null,
      job_date: form.job_date,
      service_type: form.service_type,
      description: form.description.trim() || null,
      member_charge: Number(form.member_charge || 0),
      vendor_rate: Number(form.vendor_rate || 0),
      job_status: form.job_status,
      notes: form.notes.trim() || null,
    }

    const { data, error: insErr } = await supabase
      .from('vendor_jobs')
      .insert(payload)
      .select()
      .single()

    if (insErr) {
      setError(insErr.message)
      setSaving(false)
      return
    }

    setJobs((prev) => [data, ...prev])
    setSaving(false)
    setLogOpen(false)
    onChange?.()
  }

  function openMarkPaid(jobId) {
    setPayForm({ payout_method: 'check', payout_date: todayIso(), payout_reference: '' })
    setPayingId(jobId)
  }

  function cancelMarkPaid() {
    setPayingId(null)
  }

  function setPayField(key, val) {
    setPayForm((f) => ({ ...f, [key]: val }))
  }

  async function handleMarkPaid(jobId) {
    setPayingSaving(true)
    setError('')

    const { data, error: updErr } = await supabase
      .from('vendor_jobs')
      .update({
        payout_status: 'paid',
        payout_method: payForm.payout_method,
        payout_date: payForm.payout_date || todayIso(),
        payout_reference: payForm.payout_reference.trim() || null,
      })
      .eq('id', jobId)
      .select()
      .single()

    if (updErr) {
      setError(updErr.message)
      setPayingSaving(false)
      return
    }

    // Best-effort: bump vendors.jobs_completed. If the older email-based
    // vendors RLS denies the update, we proceed — the job is paid, which
    // is the load-bearing state. The vendor's counter is cosmetic.
    try {
      const { data: vRow } = await supabase
        .from('vendors')
        .select('jobs_completed')
        .eq('id', vendorId)
        .maybeSingle()
      if (vRow) {
        await supabase
          .from('vendors')
          .update({ jobs_completed: (vRow.jobs_completed ?? 0) + 1 })
          .eq('id', vendorId)
      }
    } catch {
      // swallow — see comment above
    }

    setJobs((prev) => prev.map((j) => (j.id === jobId ? data : j)))
    setPayingId(null)
    setPayingSaving(false)
    onChange?.()
  }

  // Live margin preview while logging.
  const previewMargin =
    Number(form.member_charge || 0) - Number(form.vendor_rate || 0)
  const previewMarginPositive = previewMargin > 0

  return (
    <div className="vj-section">
      <div className="vj-header">
        <h4 className="vj-title">Jobs &amp; Payouts</h4>
        {!logOpen && (
          <button type="button" className="btn-link" onClick={openLog}>
            + Log Job
          </button>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      <div className="vj-stat-strip">
        <Stat label="Total jobs" value={totalJobs} />
        <Stat label="Total billed" value={money(totalBilled)} />
        <Stat label="Paid out" value={money(totalPaidOut)} />
        <Stat
          label="Pending payout"
          value={money(pendingPayout)}
          tone={pendingPayout > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="NoWorry margin"
          value={money(totalMargin)}
          tone={totalMargin > 0 ? 'good' : 'neutral'}
        />
      </div>

      {logOpen && (
        <form onSubmit={handleLog} className="admin-panel vj-log-form">
          <h4 className="form-subhead">Log job</h4>
          <div className="form-row form-row-3">
            <label className="form-label">
              Date
              <input
                type="date"
                value={form.job_date}
                onChange={(e) => setField('job_date', e.target.value)}
                required
                className="form-input"
              />
            </label>
            <label className="form-label">
              Service
              <select
                value={form.service_type}
                onChange={(e) => setField('service_type', e.target.value)}
                className="form-input"
              >
                {SERVICE_TYPES.map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Status
              <select
                value={form.job_status}
                onChange={(e) => setField('job_status', e.target.value)}
                className="form-input"
              >
                {JOB_STATUSES.map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row form-row-3">
            <label className="form-label">
              Member charge
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.member_charge}
                onChange={(e) => setField('member_charge', e.target.value)}
                required
                className="form-input"
                placeholder="0.00"
              />
            </label>
            <label className="form-label">
              Vendor rate
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.vendor_rate}
                onChange={(e) => setField('vendor_rate', e.target.value)}
                required
                className="form-input"
                placeholder="0.00"
              />
            </label>
            <label className="form-label">
              Circle ID (optional)
              <input
                type="text"
                value={form.circle_id}
                onChange={(e) => setField('circle_id', e.target.value)}
                className="form-input"
                placeholder="UUID, optional"
              />
            </label>
          </div>
          <p className={`vj-margin-preview ${previewMarginPositive ? 'vj-margin-good' : ''}`}>
            NoWorry margin: {money(previewMargin)}
          </p>
          <label className="form-label">
            Description (optional)
            <input
              type="text"
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              className="form-input"
            />
          </label>
          <label className="form-label">
            Notes (optional)
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className="form-input"
              rows={2}
            />
          </label>
          <div className="admin-panel-actions">
            <button
              type="submit"
              className="btn-primary-full"
              disabled={saving || !form.member_charge || !form.vendor_rate}
            >
              {saving ? 'Saving…' : 'Log job'}
            </button>
            <button type="button" className="btn-back" onClick={closeLog} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!loaded ? (
        <p className="admin-meta">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="page-placeholder">No jobs yet for this vendor. Use Log Job above.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table vj-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Service</th>
                <th>Billed</th>
                <th>Vendor</th>
                <th>Margin</th>
                <th>Status</th>
                <th>Payout</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const isPaying = payingId === j.id
                return (
                  <Fragment key={j.id}>
                    <tr>
                      <td>{fmtJobDate(j.job_date)}</td>
                      <td>{SERVICE_LABEL[j.service_type] ?? j.service_type}</td>
                      <td>{money(j.member_charge)}</td>
                      <td>{money(j.vendor_rate)}</td>
                      <td className={Number(j.noworry_margin) > 0 ? 'vj-margin-good' : ''}>
                        {money(j.noworry_margin)}
                      </td>
                      <td>
                        <span className={`admin-pill vj-status-${j.job_status}`}>
                          {JOB_STATUS_LABEL[j.job_status] ?? j.job_status}
                        </span>
                      </td>
                      <td>
                        <div className="vj-payout-cell">
                          <span className={`admin-pill vj-payout-${j.payout_status}`}>
                            {j.payout_status === 'paid' ? 'Paid' : 'Pending'}
                          </span>
                          {j.payout_status === 'paid' && j.payout_date && (
                            <span className="admin-meta">{fmtPayoutDate(j.payout_date)}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {j.payout_status === 'pending' && !isPaying && (
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => openMarkPaid(j.id)}
                          >
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                    {isPaying && (
                      <tr className="admin-row-expand">
                        <td colSpan={8}>
                          <div className="vj-pay-form">
                            <label className="form-label">
                              Method
                              <select
                                value={payForm.payout_method}
                                onChange={(e) => setPayField('payout_method', e.target.value)}
                                className="form-input"
                              >
                                {PAYOUT_METHODS.map(([k, l]) => (
                                  <option key={k} value={k}>{l}</option>
                                ))}
                              </select>
                            </label>
                            <label className="form-label">
                              Date
                              <input
                                type="date"
                                value={payForm.payout_date}
                                onChange={(e) => setPayField('payout_date', e.target.value)}
                                className="form-input"
                              />
                            </label>
                            <label className="form-label">
                              Reference (optional)
                              <input
                                type="text"
                                value={payForm.payout_reference}
                                onChange={(e) => setPayField('payout_reference', e.target.value)}
                                className="form-input"
                                placeholder="Check #, txn ID…"
                              />
                            </label>
                            <div className="vj-pay-actions">
                              <button
                                type="button"
                                className="btn-link"
                                onClick={cancelMarkPaid}
                                disabled={payingSaving}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleMarkPaid(j.id)}
                                disabled={payingSaving}
                              >
                                {payingSaving ? 'Saving…' : 'Mark as Paid'}
                              </button>
                            </div>
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

function Stat({ label, value, tone = 'neutral' }) {
  return (
    <div className={`vj-stat vj-stat-${tone}`}>
      <span className="vj-stat-value">{value}</span>
      <span className="vj-stat-label">{label}</span>
    </div>
  )
}
