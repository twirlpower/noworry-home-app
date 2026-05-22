import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const TIERS = [
  ['aware',    'Aware'],
  ['prepared', 'Prepared'],
  ['covered',  'Covered'],
  ['complete', 'Complete'],
]
const TIER_LABEL = Object.fromEntries(TIERS)
const TIER_PILL_COLOR = {
  aware:    'blue',
  prepared: 'amber',
  covered:  'green',
  complete: 'dark-green',
}

// Billing status pill color mapping per spec.
const BILLING_PILL_COLOR = {
  trial:    'amber',
  active:   'green',
  past_due: 'red',
  canceled: 'gray',
  churned:  'dark-red',
}
const BILLING_LABEL = {
  trial: 'Trial', active: 'Active', past_due: 'Past Due',
  canceled: 'Canceled', churned: 'Churned',
}

const MS_PER_DAY = 86400000

function fullName(c) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || '(no name)'
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function trialLabel(c, nowMs) {
  if (!c.trial_ends_at) return '—'
  const end = new Date(c.trial_ends_at).getTime()
  const days = Math.ceil((end - nowMs) / MS_PER_DAY)
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} remaining`
  return 'Expired'
}

async function bearer() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? ''
}

export default function CRMCustomersTab({ onChange }) {
  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  // Stable "now" — keeps Date.now() out of render per lint baseline.
  const [nowMs] = useState(() => Date.now())

  // Edit-info inline form per row.
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', phone: '' })
  const [editSaving, setEditSaving] = useState(false)

  // Change-tier inline confirm per row.
  const [tierChangeId, setTierChangeId] = useState(null)
  const [tierChangeTo, setTierChangeTo] = useState('')
  const [tierChangeSaving, setTierChangeSaving] = useState(false)

  // Per-row password reset cooldown.
  const [resetCooldown, setResetCooldown] = useState({}) // { [circleId]: msUntilReset }

  // Disable confirm.
  const [disablingId, setDisablingId] = useState(null)
  const [disableSaving, setDisableSaving] = useState(false)

  // Delete two-step.
  const [deleteStep1Id, setDeleteStep1Id] = useState(null)
  const [deleteStep2Id, setDeleteStep2Id] = useState(null)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [deleteSaving, setDeleteSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_list_customers').then(({ data, error: e }) => {
      if (cancelled) return
      if (e) setError(e.message)
      else setRows(data ?? [])
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  async function reload() {
    const { data, error: e } = await supabase.rpc('admin_list_customers')
    if (e) setError(e.message)
    else { setRows(data ?? []); onChange?.() }
  }

  function openEdit(c) {
    setEditForm({ first_name: c.first_name ?? '', last_name: c.last_name ?? '', phone: c.phone ?? '' })
    setEditingId(c.person_id)
    setNotice('')
  }
  function closeEdit() { setEditingId(null) }

  async function saveEdit(c) {
    setEditSaving(true); setError('')
    const { error: e } = await supabase.rpc('admin_update_person', {
      p_person_id:  c.person_id,
      p_first_name: editForm.first_name.trim(),
      p_last_name:  editForm.last_name.trim(),
      p_phone:      editForm.phone.trim() || null,
    })
    setEditSaving(false)
    if (e) { setError(e.message); return }
    setEditingId(null)
    setNotice('Saved.')
    await reload()
  }

  function openTierChange(c) {
    setTierChangeTo(c.subscription_tier)
    setTierChangeId(c.circle_id)
    setNotice('')
  }
  function closeTierChange() { setTierChangeId(null) }

  async function confirmTierChange(c) {
    if (!tierChangeTo || tierChangeTo === c.subscription_tier) {
      closeTierChange(); return
    }
    setTierChangeSaving(true); setError('')
    const { error: e } = await supabase.rpc('admin_set_circle_tier', {
      p_circle_id: c.circle_id,
      p_tier:      tierChangeTo,
    })
    setTierChangeSaving(false)
    if (e) { setError(e.message); return }
    closeTierChange()
    setNotice(`Tier set to ${TIER_LABEL[tierChangeTo] ?? tierChangeTo}.`)
    await reload()
  }

  async function sendPasswordReset(c) {
    setError(''); setNotice('')
    const token = await bearer()
    if (!token) { setError('Your session expired. Sign in again.'); return }
    const res = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: c.email }),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) { setError(payload.error || 'Reset failed.'); return }
    setNotice(`Reset email sent to ${c.email}.`)
    // 60-second cooldown.
    setResetCooldown((prev) => ({ ...prev, [c.circle_id]: Date.now() + 60000 }))
    setTimeout(() => {
      setResetCooldown((prev) => {
        const next = { ...prev }
        delete next[c.circle_id]
        return next
      })
    }, 60000)
  }

  async function confirmDisable(c) {
    setDisableSaving(true); setError('')
    const token = await bearer()
    if (!token) { setError('Your session expired. Sign in again.'); setDisableSaving(false); return }
    const res = await fetch('/api/admin/disable-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: c.auth_user_id }),
    })
    const payload = await res.json().catch(() => ({}))
    setDisableSaving(false)
    if (!res.ok) { setError(payload.error || 'Disable failed.'); return }
    setDisablingId(null)
    setNotice(`${fullName(c)}'s account disabled.`)
    await reload()
  }

  function openDelete(c) {
    setDeleteStep1Id(c.circle_id); setDeleteStep2Id(null); setDeleteConfirmEmail('')
  }
  function advanceDelete(c) {
    setDeleteStep1Id(null); setDeleteStep2Id(c.circle_id); setDeleteConfirmEmail('')
  }
  function cancelDelete() {
    setDeleteStep1Id(null); setDeleteStep2Id(null); setDeleteConfirmEmail('')
  }

  async function confirmDelete(c) {
    if (deleteConfirmEmail.trim().toLowerCase() !== (c.email ?? '').toLowerCase()) {
      setError('Email does not match.'); return
    }
    setDeleteSaving(true); setError('')
    const token = await bearer()
    if (!token) { setError('Your session expired. Sign in again.'); setDeleteSaving(false); return }
    const res = await fetch('/api/admin/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: c.auth_user_id, confirmEmail: c.email }),
    })
    const payload = await res.json().catch(() => ({}))
    setDeleteSaving(false)
    if (!res.ok) { setError(payload.error || payload.detail || 'Delete failed.'); return }
    cancelDelete()
    setRows((prev) => prev.filter((r) => r.circle_id !== c.circle_id))
    setNotice(`${fullName(c)} permanently deleted.`)
    onChange?.()
  }

  if (!loaded) {
    return (
      <div className="admin-loading" role="status">
        <div className="loading-spinner" />
        <p>Loading customers…</p>
      </div>
    )
  }

  return (
    <div className="admin-tab">
      <div className="admin-tab-header">
        <h2>Customers <span className="admin-count">({rows.length})</span></h2>
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}

      {rows.length === 0 ? (
        <p className="page-placeholder">No customers yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Tier</th><th>Billing</th>
                <th>Trial</th><th>Member Since</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const open = expandedId === c.circle_id
                const cooldownMs = resetCooldown[c.circle_id]
                const tierColor = TIER_PILL_COLOR[c.subscription_tier] ?? 'gray'
                const billColor = BILLING_PILL_COLOR[c.billing_status] ?? 'gray'
                const billLabel = BILLING_LABEL[c.billing_status] ?? (c.billing_status ?? '—')
                return (
                  <Fragment key={c.circle_id}>
                    <tr className={open ? 'admin-row-open' : ''}
                        onClick={() => setExpandedId(open ? null : c.circle_id)}>
                      <td><strong>{fullName(c)}</strong></td>
                      <td>{c.email || '—'}</td>
                      <td><span className={`admin-pill admin-pill-color-${tierColor}`}>{TIER_LABEL[c.subscription_tier] ?? c.subscription_tier}</span></td>
                      <td>{c.billing_status ? <span className={`admin-pill admin-pill-color-${billColor}`}>{billLabel}</span> : <span className="admin-meta">—</span>}</td>
                      <td>{c.billing_status === 'trial' ? trialLabel(c, nowMs) : <span className="admin-meta">—</span>}</td>
                      <td>{fmtDate(c.member_since)}</td>
                      <td className="admin-meta">{c.role}</td>
                    </tr>
                    {open && (
                      <tr className="admin-row-expand">
                        <td colSpan={7}>
                          <div className="admin-expand-body" onClick={(e) => e.stopPropagation()}>
                            <div className="admin-expand-grid">
                              <div><strong>Phone:</strong> {c.phone || <em className="admin-meta">—</em>}</div>
                              <div><strong>Role:</strong> {c.role}</div>
                              <div><strong>Period end:</strong> {fmtDate(c.current_period_end)}</div>
                              <div className="admin-meta"><strong>Circle ID:</strong> <code>{c.circle_id}</code></div>
                            </div>

                            {editingId === c.person_id ? (
                              <div className="admin-panel">
                                <h3 className="form-subhead">Edit info</h3>
                                <div className="form-row">
                                  <label className="form-label">First name
                                    <input type="text" value={editForm.first_name}
                                           onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                                           className="form-input" />
                                  </label>
                                  <label className="form-label">Last name
                                    <input type="text" value={editForm.last_name}
                                           onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                                           className="form-input" />
                                  </label>
                                </div>
                                <label className="form-label">Phone
                                  <input type="tel" value={editForm.phone}
                                         onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                                         className="form-input" />
                                </label>
                                <div className="admin-panel-actions">
                                  <button type="button" className="btn-primary-full"
                                          onClick={() => saveEdit(c)} disabled={editSaving}>
                                    {editSaving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button type="button" className="btn-back" onClick={closeEdit}>Cancel</button>
                                </div>
                              </div>
                            ) : tierChangeId === c.circle_id ? (
                              <div className="admin-panel">
                                <h3 className="form-subhead">Change tier for {fullName(c)}</h3>
                                <label className="form-label">New tier
                                  <select value={tierChangeTo}
                                          onChange={(e) => setTierChangeTo(e.target.value)}
                                          className="form-input">
                                    {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                  </select>
                                </label>
                                <p className="admin-meta">Currently: {TIER_LABEL[c.subscription_tier]}. This is a manual override (no Stripe action).</p>
                                <div className="admin-panel-actions">
                                  <button type="button" className="btn-primary-full"
                                          onClick={() => confirmTierChange(c)} disabled={tierChangeSaving}>
                                    {tierChangeSaving ? 'Saving…' : `Set to ${TIER_LABEL[tierChangeTo] ?? tierChangeTo}`}
                                  </button>
                                  <button type="button" className="btn-back" onClick={closeTierChange}>Cancel</button>
                                </div>
                              </div>
                            ) : disablingId === c.circle_id ? (
                              <div className="admin-panel" role="alert">
                                <h3 className="form-subhead">Disable {fullName(c)}'s account?</h3>
                                <p>They won't be able to log in but their data will be preserved.</p>
                                <div className="admin-panel-actions">
                                  <button type="button" className="btn-back" onClick={() => setDisablingId(null)}>Cancel</button>
                                  <button type="button" className="btn-primary-full btn-link-danger"
                                          onClick={() => confirmDisable(c)} disabled={disableSaving}>
                                    {disableSaving ? 'Disabling…' : 'Yes, disable'}
                                  </button>
                                </div>
                              </div>
                            ) : deleteStep1Id === c.circle_id ? (
                              <div className="admin-panel" role="alert">
                                <h3 className="form-subhead">Delete {fullName(c)}'s account?</h3>
                                <p>
                                  This permanently removes their account and all associated data.
                                  This cannot be undone.
                                </p>
                                <div className="admin-panel-actions">
                                  <button type="button" className="btn-back" onClick={cancelDelete}>Cancel</button>
                                  <button type="button" className="btn-link btn-link-danger"
                                          onClick={() => advanceDelete(c)}>
                                    Continue →
                                  </button>
                                </div>
                              </div>
                            ) : deleteStep2Id === c.circle_id ? (
                              <div className="admin-panel" role="alert">
                                <h3 className="form-subhead">Type their email to confirm</h3>
                                <p>Expected: <code>{c.email}</code></p>
                                <label className="form-label">
                                  <input type="email" value={deleteConfirmEmail}
                                         onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                                         className="form-input"
                                         placeholder={c.email ?? ''} />
                                </label>
                                <div className="admin-panel-actions">
                                  <button type="button" className="btn-back" onClick={cancelDelete}>Cancel</button>
                                  <button type="button" className="btn-primary-full btn-link-danger"
                                          onClick={() => confirmDelete(c)}
                                          disabled={deleteSaving || deleteConfirmEmail.trim().toLowerCase() !== (c.email ?? '').toLowerCase()}>
                                    {deleteSaving ? 'Deleting…' : 'Permanently Delete'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="customer-actions">
                                <button type="button" className="btn-link"
                                        onClick={() => sendPasswordReset(c)}
                                        disabled={!!cooldownMs}>
                                  {cooldownMs ? 'Reset sent — wait 60s' : 'Send Password Reset'}
                                </button>
                                <button type="button" className="btn-link" onClick={() => openEdit(c)}>Edit Info</button>
                                <button type="button" className="btn-link" onClick={() => openTierChange(c)}>Change Tier</button>
                                <button type="button" className="btn-link btn-link-danger"
                                        onClick={() => setDisablingId(c.circle_id)}>Disable Account</button>
                                <button type="button" className="btn-link btn-link-danger"
                                        onClick={() => openDelete(c)}>Delete Account</button>
                              </div>
                            )}
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
