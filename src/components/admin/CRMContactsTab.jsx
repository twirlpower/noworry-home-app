import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const TIERS = [
  ['lead', 'Lead'],
  ['aware', 'Aware'],
  ['prepared', 'Prepared'],
  ['covered', 'Covered'],
  ['complete', 'Complete'],
]

const SOURCES = [
  ['personal_network', 'Personal Network'],
  ['referral_partner', 'Referral Partner'],
  ['cold', 'Cold'],
  ['other', 'Other'],
]

const EMPTY_FORM = {
  name: '',
  phone: '',
  email: '',
  source: 'personal_network',
  tier: 'lead',
  mrr: '',
  notes: '',
  next_action: '',
}

function contactToForm(c) {
  return {
    name: c.name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    source: c.source ?? 'personal_network',
    tier: c.tier ?? 'lead',
    mrr: c.mrr != null ? String(c.mrr) : '',
    notes: c.notes ?? '',
    next_action: c.next_action ?? '',
  }
}

function tierPillClass(tier) {
  return `admin-pill admin-pill-tier-${tier}`
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function CRMContactsTab({ onChange }) {
  const [contacts, setContacts] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [panelMode, setPanelMode] = useState(null) // null | 'new' | <uuid>
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('crm_contacts')
      .select('*')
      .order('date_added', { ascending: false })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setContacts(data ?? [])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    const { data, error: e } = await supabase
      .from('crm_contacts')
      .select('*')
      .order('date_added', { ascending: false })
    if (e) setError(e.message)
    else {
      setContacts(data ?? [])
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

  function openEdit(c) {
    setForm(contactToForm(c))
    setError('')
    setPanelMode(c.id)
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
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      source: form.source || null,
      tier: form.tier,
      mrr: form.mrr ? Number(form.mrr) : 0,
      notes: form.notes.trim() || null,
      next_action: form.next_action.trim() || null,
    }

    let res
    if (panelMode === 'new') {
      res = await supabase.from('crm_contacts').insert(payload).select().single()
      if (!res.error && res.data) {
        // Optimistic prepend (already sorted by date_added desc — new rows land at top)
        setContacts((prev) => [res.data, ...prev])
        onChange?.()
      }
    } else {
      res = await supabase.from('crm_contacts').update(payload).eq('id', panelMode)
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
        <p>Loading contacts…</p>
      </div>
    )
  }

  return (
    <div className="admin-tab">
      <div className="admin-tab-header">
        <h2>Contacts <span className="admin-count">({contacts.length})</span></h2>
        {panelMode === null && (
          <button className="btn-secondary" onClick={openAdd}>Add Contact</button>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {panelMode !== null && (
        <form onSubmit={handleSave} className="admin-panel">
          <h3 className="form-subhead">
            {panelMode === 'new' ? 'New contact' : 'Edit contact'}
          </h3>
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
          <div className="form-row">
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
          <div className="form-row form-row-3">
            <label className="form-label">
              Source
              <select
                value={form.source}
                onChange={(e) => setField('source', e.target.value)}
                className="form-input"
              >
                {SOURCES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Tier
              <select
                value={form.tier}
                onChange={(e) => setField('tier', e.target.value)}
                className="form-input"
              >
                {TIERS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              MRR ($)
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.mrr}
                onChange={(e) => setField('mrr', e.target.value)}
                className="form-input"
              />
            </label>
          </div>
          <label className="form-label">
            Next action
            <input
              type="text"
              value={form.next_action}
              onChange={(e) => setField('next_action', e.target.value)}
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
              {saving ? 'Saving…' : panelMode === 'new' ? 'Add Contact' : 'Save Changes'}
            </button>
            <button type="button" className="btn-back" onClick={closePanel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {contacts.length === 0 ? (
        <p className="page-placeholder">No contacts yet. Add your first.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone / Email</th>
                <th>Source</th>
                <th>Tier</th>
                <th>Added</th>
                <th>Converted</th>
                <th>MRR</th>
                <th>Next Action</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const open = expandedId === c.id
                return (
                  <Fragment key={c.id}>
                    <tr
                      className={open ? 'admin-row-open' : ''}
                      onClick={() => setExpandedId(open ? null : c.id)}
                    >
                      <td><strong>{c.name}</strong></td>
                      <td className="admin-cell-stack">
                        {c.phone && <span>{c.phone}</span>}
                        {c.email && <span className="admin-meta">{c.email}</span>}
                        {!c.phone && !c.email && <span className="admin-meta">—</span>}
                      </td>
                      <td>{SOURCES.find(([v]) => v === c.source)?.[1] ?? c.source ?? '—'}</td>
                      <td>
                        <span className={tierPillClass(c.tier)}>
                          {TIERS.find(([v]) => v === c.tier)?.[1] ?? c.tier}
                        </span>
                      </td>
                      <td>{fmtDate(c.date_added)}</td>
                      <td>{fmtDate(c.converted_at)}</td>
                      <td>{Number(c.mrr) > 0 ? `$${Number(c.mrr).toFixed(2)}` : '—'}</td>
                      <td className="admin-cell-truncate">{c.next_action || '—'}</td>
                    </tr>
                    {open && (
                      <tr className="admin-row-expand">
                        <td colSpan={8}>
                          <div className="admin-expand-body">
                            <div>
                              <strong>Notes</strong>
                              <p>{c.notes || <em className="admin-meta">No notes</em>}</p>
                            </div>
                            <button
                              type="button"
                              className="btn-link"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEdit(c)
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
