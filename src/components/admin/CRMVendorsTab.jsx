import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import VendorJobsSection from './VendorJobsSection'

const TRADES = [
  ['hvac', 'HVAC'],
  ['plumbing', 'Plumbing'],
  ['electrical', 'Electrical'],
  ['handyman', 'Handyman'],
  ['seasonal_exterior', 'Seasonal & Exterior'],
  ['other', 'Other'],
]

const STATUSES = [
  ['prospect', 'Prospect'],
  ['onboarding', 'Onboarding'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['do_not_use', 'Do Not Use'],
]

const TECH_TIERS = [
  ['onboarding', 'Onboarding (1)'],
  ['active_partner', 'Active Partner (3)'],
  ['established', 'Established (unlimited)'],
]

const EMPTY_FORM = {
  name: '',
  trade: 'hvac',
  contact_name: '',
  phone: '',
  email: '',
  founding_partner: false,
  notes: '',
}

const EMPTY_EDIT_FORM = {
  ...EMPTY_FORM,
  status: 'prospect',
  tech_tier: 'onboarding',
  agreement_signed_at: '',
  activation_fee_paid: false,
  jobs_dispatched: '',
  guarantee_claims: '',
}

function vendorToForm(v) {
  return {
    name: v.name ?? '',
    trade: v.trade ?? 'hvac',
    contact_name: v.contact_name ?? '',
    phone: v.phone ?? '',
    email: v.email ?? '',
    founding_partner: !!v.founding_partner,
    notes: v.notes ?? '',
    status: v.status ?? 'prospect',
    tech_tier: v.tech_tier ?? 'onboarding',
    agreement_signed_at: v.agreement_signed_at ?? '',
    activation_fee_paid: !!v.activation_fee_paid,
    jobs_dispatched: v.jobs_dispatched != null ? String(v.jobs_dispatched) : '',
    guarantee_claims: v.guarantee_claims != null ? String(v.guarantee_claims) : '',
  }
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

function statusPillClass(s) {
  return `admin-pill admin-pill-status-${s}`
}

export default function CRMVendorsTab({ onChange }) {
  const [vendors, setVendors] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [panelMode, setPanelMode] = useState(null)
  const [form, setForm] = useState(EMPTY_EDIT_FORM)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('vendors')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setVendors(data ?? [])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    const { data, error: e } = await supabase
      .from('vendors')
      .select('*')
      .order('created_at', { ascending: false })
    if (e) setError(e.message)
    else {
      setVendors(data ?? [])
      onChange?.()
    }
  }

  function setField(key, val) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function openAdd() {
    setForm({ ...EMPTY_EDIT_FORM, ...EMPTY_FORM, status: 'prospect', tech_tier: 'onboarding' })
    setError('')
    setPanelMode('new')
  }

  function openEdit(v) {
    setForm(vendorToForm(v))
    setError('')
    setPanelMode(v.id)
  }

  function closePanel() {
    setPanelMode(null)
    setError('')
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    let res
    if (panelMode === 'new') {
      // Status and tech_tier auto-set on create (per spec)
      const payload = {
        name: form.name.trim(),
        trade: form.trade,
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        founding_partner: form.founding_partner,
        notes: form.notes.trim() || null,
        status: 'prospect',
        tech_tier: 'onboarding',
      }
      res = await supabase.from('vendors').insert(payload).select().maybeSingle()
      if (!res.error && res.data) {
        setVendors((prev) => [res.data, ...prev])
        onChange?.()
      }
    } else {
      const payload = {
        name: form.name.trim(),
        trade: form.trade,
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        founding_partner: form.founding_partner,
        notes: form.notes.trim() || null,
        status: form.status,
        tech_tier: form.tech_tier,
        agreement_signed_at: form.agreement_signed_at || null,
        activation_fee_paid: form.activation_fee_paid,
        jobs_dispatched: form.jobs_dispatched ? Number(form.jobs_dispatched) : 0,
        guarantee_claims: form.guarantee_claims ? Number(form.guarantee_claims) : 0,
      }
      res = await supabase.from('vendors').update(payload).eq('id', panelMode)
    }

    if (res.error) {
      setError(res.error.message)
      setSaving(false)
      return
    }

    setSaving(false)
    setPanelMode(null)
    if (panelMode !== 'new') await reload()
  }

  if (!loaded) {
    return (
      <div className="admin-loading" role="status">
        <div className="loading-spinner" />
        <p>Loading vendors…</p>
      </div>
    )
  }

  const isEdit = panelMode !== null && panelMode !== 'new'

  return (
    <div className="admin-tab">
      <div className="admin-tab-header">
        <h2>Vendors <span className="admin-count">({vendors.length})</span></h2>
        {panelMode === null && (
          <button className="btn-secondary" onClick={openAdd}>Add Vendor</button>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {panelMode !== null && (
        <form onSubmit={handleSave} className="admin-panel">
          <h3 className="form-subhead">
            {panelMode === 'new' ? 'New vendor' : 'Edit vendor'}
          </h3>
          <div className="form-row">
            <label className="form-label">
              Name
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                required
                className="form-input"
              />
            </label>
            <label className="form-label">
              Trade
              <select
                value={form.trade}
                onChange={(e) => setField('trade', e.target.value)}
                className="form-input"
              >
                {TRADES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row form-row-3">
            <label className="form-label">
              Contact name
              <input
                type="text"
                value={form.contact_name}
                onChange={(e) => setField('contact_name', e.target.value)}
                className="form-input"
              />
            </label>
            <label className="form-label">
              Phone
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                className="form-input"
              />
            </label>
            <label className="form-label">
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                className="form-input"
              />
            </label>
          </div>
          <label className="form-label form-checkbox">
            <input
              type="checkbox"
              checked={form.founding_partner}
              onChange={(e) => setField('founding_partner', e.target.checked)}
            />
            Founding partner
          </label>

          {isEdit && (
            <>
              <div className="form-row form-row-3">
                <label className="form-label">
                  Status
                  <select
                    value={form.status}
                    onChange={(e) => setField('status', e.target.value)}
                    className="form-input"
                  >
                    {STATUSES.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Tech tier
                  <select
                    value={form.tech_tier}
                    onChange={(e) => setField('tech_tier', e.target.value)}
                    className="form-input"
                  >
                    {TECH_TIERS.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Agreement signed
                  <input
                    type="date"
                    value={form.agreement_signed_at}
                    onChange={(e) => setField('agreement_signed_at', e.target.value)}
                    className="form-input"
                  />
                </label>
              </div>
              <div className="form-row form-row-3">
                <label className="form-label form-checkbox">
                  <input
                    type="checkbox"
                    checked={form.activation_fee_paid}
                    onChange={(e) => setField('activation_fee_paid', e.target.checked)}
                  />
                  Activation fee paid
                </label>
                <label className="form-label">
                  Jobs dispatched
                  <input
                    type="number"
                    min="0"
                    value={form.jobs_dispatched}
                    onChange={(e) => setField('jobs_dispatched', e.target.value)}
                    className="form-input"
                  />
                </label>
                <label className="form-label">
                  Guarantee claims
                  <input
                    type="number"
                    min="0"
                    value={form.guarantee_claims}
                    onChange={(e) => setField('guarantee_claims', e.target.value)}
                    className="form-input"
                  />
                </label>
              </div>
            </>
          )}

          <label className="form-label">
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className="form-input"
              rows={3}
            />
          </label>
          <div className="admin-panel-actions">
            <button type="submit" className="btn-primary-full" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : panelMode === 'new' ? 'Add Vendor' : 'Save Changes'}
            </button>
            <button type="button" className="btn-back" onClick={closePanel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {vendors.length === 0 ? (
        <p className="page-placeholder">No vendors yet. Add your first.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Trade</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Tech Tier</th>
                <th>Founding</th>
                <th>Signed</th>
                <th>Jobs</th>
                <th>Claims</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const open = expandedId === v.id
                return (
                  <Fragment key={v.id}>
                    <tr
                      className={open ? 'admin-row-open' : ''}
                      onClick={() => setExpandedId(open ? null : v.id)}
                    >
                      <td><strong>{v.name}</strong></td>
                      <td>{TRADES.find(([k]) => k === v.trade)?.[1] ?? v.trade ?? '—'}</td>
                      <td className="admin-cell-stack">
                        {v.contact_name && <span>{v.contact_name}</span>}
                        {v.phone && <span className="admin-meta">{v.phone}</span>}
                        {!v.contact_name && !v.phone && <span className="admin-meta">—</span>}
                      </td>
                      <td>
                        <span className={statusPillClass(v.status)}>
                          {STATUSES.find(([k]) => k === v.status)?.[1] ?? v.status}
                        </span>
                      </td>
                      <td>{TECH_TIERS.find(([k]) => k === v.tech_tier)?.[1] ?? v.tech_tier ?? '—'}</td>
                      <td>{v.founding_partner ? <span title="Founding partner">⭐</span> : '—'}</td>
                      <td>{fmtDate(v.agreement_signed_at)}</td>
                      <td>{v.jobs_dispatched ?? 0}</td>
                      <td>{v.guarantee_claims ?? 0}</td>
                      <td className="admin-cell-truncate">{v.notes || '—'}</td>
                    </tr>
                    {open && (
                      <tr className="admin-row-expand">
                        <td colSpan={10}>
                          {v.status === 'do_not_use' && (
                            <div className="admin-do-not-use-banner" role="alert">
                              ⚠️ Do Not Use — excluded from dispatch.
                            </div>
                          )}
                          <div className="admin-expand-body">
                            <div className="admin-expand-grid">
                              <div>
                                <strong>Email:</strong> {v.email || <em className="admin-meta">—</em>}
                              </div>
                              <div>
                                <strong>Territory:</strong> {v.territory || <em className="admin-meta">—</em>}
                              </div>
                              <div>
                                <strong>Jobs completed:</strong> {v.jobs_completed ?? 0}
                              </div>
                              <div>
                                <strong>Activation fee paid:</strong> {v.activation_fee_paid ? 'Yes' : 'No'}
                              </div>
                              <div className="admin-expand-grid-full">
                                <strong>Notes:</strong> {v.notes || <em className="admin-meta">No notes</em>}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn-link"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEdit(v)
                              }}
                            >
                              Edit
                            </button>
                          </div>

                          {/* Jobs & Payouts — lazy-loads vendor_jobs for this
                              vendor on mount. Bubbles bump callbacks up to
                              parent so the CRM-level pending-payout stat
                              refreshes after job inserts / mark-paid. */}
                          <div onClick={(e) => e.stopPropagation()}>
                            <VendorJobsSection vendorId={v.id} onChange={onChange} />
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
