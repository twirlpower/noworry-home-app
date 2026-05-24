import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Pipeline statuses per the locked spec. crm_contacts.status now drives
// the pill; the legacy `tier` column stays in the DB but is hidden in
// this UI (it conflicted conceptually with family_circles.subscription_tier
// for real customers).
const STATUSES = [
  ['lead',      'Lead'],
  ['contacted', 'Contacted'],
  ['qualified', 'Qualified'],
  ['converted', 'Converted'],
  ['inactive',  'Inactive'],
]
const STATUS_LABEL = Object.fromEntries(STATUSES)
const STATUS_PILL_COLOR = {
  lead:      'gray',
  contacted: 'blue',
  qualified: 'green',
  converted: 'amber',
  inactive:  'light',
}

const SOURCES = [
  ['personal_network', 'Personal Network'],
  ['referral_partner', 'Referral Partner'],
  ['website',          'Website Form'],
  ['cold',             'Cold'],
  ['other',            'Other'],
]

const EMPTY_FORM = {
  name: '',
  phone: '',
  email: '',
  source: 'personal_network',
  status: 'lead',
  notes: '',
  next_action: '',
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

function contactToForm(c) {
  return {
    name:        c.name ?? '',
    phone:       c.phone ?? '',
    email:       c.email ?? '',
    source:      c.source ?? 'personal_network',
    status:      c.status ?? 'lead',
    notes:       c.notes ?? '',
    next_action: c.next_action ?? '',
  }
}

export default function CRMProspectsTab({ onChange }) {
  const [contacts, setContacts] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [panelMode, setPanelMode] = useState(null) // null | 'new' | <uuid>
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  // Convert flow state.
  const [convertingId, setConvertingId] = useState(null)
  const [convertSearch, setConvertSearch] = useState('')
  const [convertResults, setConvertResults] = useState([])
  const [convertLoading, setConvertLoading] = useState(false)
  const [convertError, setConvertError] = useState('')

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
    return () => { cancelled = true }
  }, [])

  async function reload() {
    const { data, error: e } = await supabase
      .from('crm_contacts')
      .select('*')
      .order('date_added', { ascending: false })
    if (e) setError(e.message)
    else { setContacts(data ?? []); onChange?.() }
  }

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  function openAdd() {
    setForm(EMPTY_FORM); setError(''); setPanelMode('new')
  }
  function openEdit(c) {
    setForm(contactToForm(c)); setError(''); setPanelMode(c.id)
  }
  function closePanel() { setPanelMode(null); setError('') }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')

    const payload = {
      name:        form.name.trim(),
      phone:       form.phone.trim() || null,
      email:       form.email.trim() || null,
      source:      form.source || null,
      status:      form.status,
      notes:       form.notes.trim() || null,
      next_action: form.next_action.trim() || null,
    }

    let res
    if (panelMode === 'new') {
      res = await supabase.from('crm_contacts').insert(payload).select().single()
      if (!res.error && res.data) {
        setContacts((prev) => [res.data, ...prev])
        onChange?.()
      }
    } else {
      res = await supabase.from('crm_contacts').update(payload).eq('id', panelMode)
    }

    if (res.error) { setError(res.error.message); setSaving(false); return }
    setSaving(false); setPanelMode(null)
    if (panelMode !== 'new') await reload()
  }

  function openConvert(contact) {
    setConvertingId(contact.id)
    setConvertSearch(contact.email || '')
    setConvertResults([])
    setConvertError('')
  }
  function closeConvert() {
    setConvertingId(null); setConvertSearch(''); setConvertResults([])
  }

  async function runConvertSearch() {
    if (!convertSearch.trim()) return
    setConvertLoading(true); setConvertError('')
    const { data, error: e } = await supabase.rpc('admin_list_customers')
    setConvertLoading(false)
    if (e) { setConvertError(e.message); return }
    const q = convertSearch.trim().toLowerCase()
    const matches = (data ?? []).filter((c) =>
      (c.email ?? '').toLowerCase().includes(q) ||
      [c.first_name, c.last_name].filter(Boolean).join(' ').toLowerCase().includes(q)
    )
    setConvertResults(matches)
  }

  async function linkAccount(contact, customer) {
    setConvertError('')
    const { error: e } = await supabase
      .from('crm_contacts')
      .update({
        status: 'converted',
        circle_id: customer.circle_id,
        converted_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
    if (e) { setConvertError(e.message); return }
    closeConvert()
    await reload()
  }

  if (!loaded) {
    return (
      <div className="admin-loading" role="status">
        <div className="loading-spinner" />
        <p>Loading leads…</p>
      </div>
    )
  }

  return (
    <div className="admin-tab">
      <div className="admin-tab-header">
        <h2>Prospects <span className="admin-count">({contacts.length})</span></h2>
        {panelMode === null && (
          <button className="btn-secondary" onClick={openAdd}>Add Prospect</button>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {panelMode !== null && (
        <form onSubmit={handleSave} className="admin-panel">
          <h3 className="form-subhead">
            {panelMode === 'new' ? 'New prospect' : 'Edit prospect'}
          </h3>
          <label className="form-label">
            Name
            <input type="text" value={form.name} onChange={(e) => setField('name', e.target.value)}
                   required className="form-input" />
          </label>
          <div className="form-row">
            <label className="form-label">
              Phone
              <input type="text" value={form.phone} onChange={(e) => setField('phone', e.target.value)}
                     className="form-input" />
            </label>
            <label className="form-label">
              Email
              <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)}
                     className="form-input" />
            </label>
          </div>
          <div className="form-row form-row-3">
            <label className="form-label">
              Source
              <select value={form.source} onChange={(e) => setField('source', e.target.value)}
                      className="form-input">
                {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="form-label">
              Status
              <select value={form.status} onChange={(e) => setField('status', e.target.value)}
                      className="form-input">
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="form-label">
              Next action
              <input type="text" value={form.next_action} onChange={(e) => setField('next_action', e.target.value)}
                     className="form-input" />
            </label>
          </div>
          <label className="form-label">
            Notes
            <textarea value={form.notes} onChange={(e) => setField('notes', e.target.value)}
                      className="form-input" rows={3} />
          </label>
          <div className="admin-panel-actions">
            <button type="submit" className="btn-primary-full" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : panelMode === 'new' ? 'Add Prospect' : 'Save Changes'}
            </button>
            <button type="button" className="btn-back" onClick={closePanel} disabled={saving}>Cancel</button>
          </div>
        </form>
      )}

      {contacts.length === 0 ? (
        <p className="page-placeholder">No prospects yet. Add your first.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th><th>Phone / Email</th><th>Source</th>
                <th>Status</th><th>Added</th><th>Next Action</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const open = expandedId === c.id
                const converting = convertingId === c.id
                const color = STATUS_PILL_COLOR[c.status] ?? 'gray'
                return (
                  <Fragment key={c.id}>
                    <tr className={open ? 'admin-row-open' : ''}
                        onClick={() => setExpandedId(open ? null : c.id)}>
                      <td><strong>{c.name}</strong></td>
                      <td className="admin-cell-stack">
                        {c.phone && <span>{c.phone}</span>}
                        {c.email && <span className="admin-meta">{c.email}</span>}
                        {!c.phone && !c.email && <span className="admin-meta">—</span>}
                      </td>
                      <td>{SOURCES.find(([v]) => v === c.source)?.[1] ?? c.source ?? '—'}</td>
                      <td><span className={`admin-pill admin-pill-color-${color}`}>{STATUS_LABEL[c.status] ?? c.status}</span></td>
                      <td>{fmtDate(c.date_added)}</td>
                      <td className="admin-cell-truncate">{c.next_action || '—'}</td>
                    </tr>
                    {open && (
                      <tr className="admin-row-expand">
                        <td colSpan={6}>
                          <div className="admin-expand-body">
                            <div>
                              <strong>Notes</strong>
                              <p>{c.notes || <em className="admin-meta">No notes</em>}</p>
                              {c.circle_id && (
                                <p className="admin-meta">Linked circle: <code>{c.circle_id}</code></p>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.8rem' }}>
                              <button type="button" className="btn-link"
                                      onClick={(e) => { e.stopPropagation(); openEdit(c) }}>
                                Edit
                              </button>
                              {c.status !== 'converted' && (
                                <button type="button" className="btn-link"
                                        onClick={(e) => { e.stopPropagation(); openConvert(c) }}>
                                  Convert
                                </button>
                              )}
                            </div>
                          </div>

                          {converting && (
                            <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
                              <h3 className="form-subhead">Convert prospect to customer</h3>
                              <p className="admin-meta admin-section-sub">
                                Has this person signed up? Search by email or name to find their account.
                              </p>
                              {convertError && <div className="auth-error" role="alert">{convertError}</div>}
                              <div className="form-row">
                                <label className="form-label" style={{ flex: 1 }}>
                                  Email or name
                                  <input type="text" value={convertSearch}
                                         onChange={(e) => setConvertSearch(e.target.value)}
                                         className="form-input" />
                                </label>
                                <button type="button" className="btn-secondary"
                                        onClick={runConvertSearch} disabled={convertLoading}>
                                  {convertLoading ? 'Searching…' : 'Search'}
                                </button>
                              </div>
                              {convertResults.length === 0 && convertSearch && !convertLoading ? (
                                <p className="page-placeholder">
                                  No account found. Share the signup link with them:{' '}
                                  <code>app.noworry-home.com/signup</code>
                                </p>
                              ) : convertResults.length > 0 ? (
                                <ul className="systems-list">
                                  {convertResults.map((cust) => (
                                    <li key={cust.circle_id} className="system-row">
                                      <div className="system-main">
                                        <span className="system-name">{cust.first_name} {cust.last_name}</span>
                                        <span className="system-meta">{cust.email}</span>
                                      </div>
                                      <button type="button" className="btn-link"
                                              onClick={() => linkAccount(c, cust)}>
                                        Link Account
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              <div className="admin-panel-actions">
                                <button type="button" className="btn-back"
                                        onClick={closeConvert}>Cancel</button>
                              </div>
                            </div>
                          )}
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
