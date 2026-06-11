import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const TYPES = [
  ['medicare_agent', 'Medicare Agent'],
  ['estate_attorney', 'Estate Attorney'],
  ['discharge_planner', 'Discharge Planner'],
  ['senior_move_manager', 'Senior Move Manager'],
  ['other', 'Other'],
]

const STATUSES = [
  ['prospect',   'Prospect'],
  ['active',     'Active'],
  ['inactive',   'Inactive'],
  ['do_not_use', 'Do Not Use'],
]
const STATUS_LABEL = Object.fromEntries(STATUSES)
const STATUS_PILL_COLOR = {
  prospect:   'gray',
  active:     'green',
  inactive:   'light',
  do_not_use: 'red',
}

const CONTACT_PREFS = [
  ['email',  'Email'],
  ['phone',  'Phone'],
  ['either', 'Either'],
]

const EMPTY_FORM = {
  name: '',
  organization: '',
  type: 'medicare_agent',
  date_met: '',
  last_contact: '',
  members_referred: '',
  active: true,
  status: 'prospect',
  phone: '',
  email: '',
  preferred_contact: 'email',
  address: '',
  notes: '',
  next_step: '',
}

function partnerToForm(p) {
  return {
    name: p.name ?? '',
    organization: p.organization ?? '',
    type: p.type ?? 'medicare_agent',
    date_met: p.date_met ?? '',
    last_contact: p.last_contact ?? '',
    members_referred: p.members_referred != null ? String(p.members_referred) : '',
    active: !!p.active,
    status: p.status ?? 'prospect',
    phone: p.phone ?? '',
    email: p.email ?? '',
    preferred_contact: p.preferred_contact ?? 'email',
    address: p.address ?? '',
    notes: p.notes ?? '',
    next_step: p.next_step ?? '',
  }
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function CRMPartnersTab({ onChange }) {
  const [partners, setPartners] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [panelMode, setPanelMode] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('crm_partners')
      .select('*')
      .order('members_referred', { ascending: false, nullsFirst: false })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setPartners(data ?? [])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    const { data, error: e } = await supabase
      .from('crm_partners')
      .select('*')
      .order('members_referred', { ascending: false, nullsFirst: false })
    if (e) setError(e.message)
    else {
      setPartners(data ?? [])
      onChange?.()
    }
  }

  function setField(key, val) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function openAdd() {
    setForm(EMPTY_FORM)
    setError('')
    setPanelMode('new')
  }

  function openEdit(p) {
    setForm(partnerToForm(p))
    setError('')
    setPanelMode(p.id)
  }

  function closePanel() {
    setPanelMode(null)
    setError('')
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      organization: form.organization.trim() || null,
      type: form.type || null,
      date_met: form.date_met || null,
      last_contact: form.last_contact || null,
      members_referred: form.members_referred ? Number(form.members_referred) : 0,
      active: form.status !== 'inactive' && form.status !== 'do_not_use',
      status: form.status,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      preferred_contact: form.preferred_contact || 'email',
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      next_step: form.next_step.trim() || null,
    }

    let res
    if (panelMode === 'new') {
      res = await supabase.from('crm_partners').insert(payload).select().maybeSingle()
      if (!res.error && res.data) {
        setPartners((prev) => [res.data, ...prev])
        onChange?.()
      }
    } else {
      res = await supabase.from('crm_partners').update(payload).eq('id', panelMode)
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
        <p>Loading partners…</p>
      </div>
    )
  }

  return (
    <div className="admin-tab">
      <div className="admin-tab-header">
        <h2>Partners <span className="admin-count">({partners.length})</span></h2>
        {panelMode === null && (
          <button className="btn-secondary" onClick={openAdd}>Add Partner</button>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {panelMode !== null && (
        <form onSubmit={handleSave} className="admin-panel">
          <h3 className="form-subhead">
            {panelMode === 'new' ? 'New partner' : 'Edit partner'}
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
              Organization
              <input
                type="text"
                value={form.organization}
                onChange={(e) => setField('organization', e.target.value)}
                className="form-input"
              />
            </label>
          </div>
          <div className="form-row form-row-3">
            <label className="form-label">
              Type
              <select
                value={form.type}
                onChange={(e) => setField('type', e.target.value)}
                className="form-input"
              >
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Date met
              <input
                type="date"
                value={form.date_met}
                onChange={(e) => setField('date_met', e.target.value)}
                className="form-input"
              />
            </label>
            <label className="form-label">
              Last contact
              <input
                type="date"
                value={form.last_contact}
                onChange={(e) => setField('last_contact', e.target.value)}
                className="form-input"
              />
            </label>
          </div>
          <div className="form-row form-row-3">
            <label className="form-label">
              Members referred
              <input
                type="number"
                min="0"
                value={form.members_referred}
                onChange={(e) => setField('members_referred', e.target.value)}
                className="form-input"
              />
            </label>
            <label className="form-label">
              Status
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value)}
                className="form-input"
              >
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="form-label">
              Preferred contact
              <select
                value={form.preferred_contact}
                onChange={(e) => setField('preferred_contact', e.target.value)}
                className="form-input"
              >
                {CONTACT_PREFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="form-label">
              Phone
              <input
                type="tel"
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
          <label className="form-label">
            Address
            <input
              type="text"
              value={form.address}
              onChange={(e) => setField('address', e.target.value)}
              className="form-input"
            />
          </label>
          <label className="form-label">
            Next step
            <input
              type="text"
              value={form.next_step}
              onChange={(e) => setField('next_step', e.target.value)}
              className="form-input"
            />
          </label>
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
              {saving ? 'Saving…' : panelMode === 'new' ? 'Add Partner' : 'Save Changes'}
            </button>
            <button type="button" className="btn-back" onClick={closePanel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {partners.length === 0 ? (
        <p className="page-placeholder">No partners yet. Add your first.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Organization</th>
                <th>Type</th>
                <th>Date Met</th>
                <th>Last Contact</th>
                <th>Referred</th>
                <th>Status</th>
                <th>Next Step</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const open = expandedId === p.id
                return (
                  <Fragment key={p.id}>
                    <tr
                      className={open ? 'admin-row-open' : ''}
                      onClick={() => setExpandedId(open ? null : p.id)}
                    >
                      <td><strong>{p.name}</strong></td>
                      <td>{p.organization || '—'}</td>
                      <td>{TYPES.find(([v]) => v === p.type)?.[1] ?? p.type ?? '—'}</td>
                      <td>{fmtDate(p.date_met)}</td>
                      <td>{fmtDate(p.last_contact)}</td>
                      <td>{p.members_referred ?? 0}</td>
                      <td>
                        {(() => {
                          const s = p.status ?? (p.active ? 'active' : 'inactive')
                          const color = STATUS_PILL_COLOR[s] ?? 'gray'
                          return (
                            <span className={`admin-pill admin-pill-color-${color}`}>
                              {s === 'do_not_use' && <span aria-hidden="true">⚠️ </span>}
                              {STATUS_LABEL[s] ?? s}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="admin-cell-truncate">{p.next_step || '—'}</td>
                    </tr>
                    {open && (
                      <tr className="admin-row-expand">
                        <td colSpan={8}>
                          {p.status === 'do_not_use' && (
                            <div className="admin-do-not-use-banner" role="alert">
                              ⚠️ Do Not Use — not shown in referral partner suggestions.
                            </div>
                          )}
                          <div className="admin-expand-body">
                            <div className="admin-expand-grid">
                              <div><strong>Phone:</strong> {p.phone || <em className="admin-meta">—</em>}</div>
                              <div><strong>Email:</strong> {p.email || <em className="admin-meta">—</em>}</div>
                              <div><strong>Preferred:</strong> {p.preferred_contact || 'email'}</div>
                              <div><strong>Address:</strong> {p.address || <em className="admin-meta">—</em>}</div>
                              <div className="admin-expand-grid-full">
                                <strong>Notes:</strong> {p.notes || <em className="admin-meta">No notes</em>}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn-link"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEdit(p)
                              }}
                            >
                              Edit
                            </button>
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
