import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const ROLE_OPTIONS = [
  ['staff', 'Staff'],
  ['readonly', 'Read-only'],
]

const ROLE_LABEL = {
  owner: 'Owner',
  staff: 'Staff',
  readonly: 'Read-only',
}

const EMPTY_FORM = {
  email: '',
  name: '',
  role: 'staff',
  notes: '',
}

export default function StaffAccountsCard() {
  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('staff_accounts')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setRows(data ?? [])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    const { data, error: e } = await supabase
      .from('staff_accounts')
      .select('*')
      .order('created_at', { ascending: true })
    if (e) setError(e.message)
    else setRows(data ?? [])
  }

  function setField(key, val) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function openAdd() {
    setForm(EMPTY_FORM)
    setError('')
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    setError('')
  }

  async function handleAdd(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    // Server-side RPC enforces owner check, auth.users lookup, and role
    // whitelist (only 'staff' / 'readonly' allowed via this path).
    const { error: e2 } = await supabase.rpc('add_staff_account', {
      p_email: form.email.trim(),
      p_name: form.name.trim(),
      p_role: form.role,
      p_notes: form.notes.trim() || null,
    })

    if (e2) {
      setError(e2.message)
      setSaving(false)
      return
    }

    setSaving(false)
    setPanelOpen(false)
    setForm(EMPTY_FORM)
    await reload()
  }

  async function toggleActive(row) {
    if (row.role === 'owner') return // guard rail — UI also disables it
    setBusyId(row.id)
    setError('')
    const { error: e } = await supabase
      .from('staff_accounts')
      .update({ active: !row.active })
      .eq('id', row.id)
    setBusyId(null)
    if (e) {
      setError(e.message)
      return
    }
    await reload()
  }

  if (!loaded) {
    return (
      <section className="admin-section">
        <h2>Staff Accounts</h2>
        <div className="admin-loading" role="status">
          <div className="loading-spinner" />
          <p>Loading staff…</p>
        </div>
      </section>
    )
  }

  return (
    <section className="admin-section">
      <div className="admin-tab-header">
        <h2>Staff Accounts</h2>
        {!panelOpen && (
          <button className="btn-secondary" onClick={openAdd}>Add Staff</button>
        )}
      </div>
      <p className="admin-meta admin-section-sub">
        To add a new staff member, first invite them via Supabase Auth
        (Authentication → Users → Invite), then add them here.
      </p>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {panelOpen && (
        <form onSubmit={handleAdd} className="admin-panel">
          <h3 className="form-subhead">New staff member</h3>
          <label className="form-label">
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              required
              className="form-input"
              placeholder="must already exist in Supabase Auth"
            />
          </label>
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
              Role
              <select
                value={form.role}
                onChange={(e) => setField('role', e.target.value)}
                className="form-input"
              >
                {ROLE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-label">
            Notes
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
              disabled={saving || !form.email.trim() || !form.name.trim()}
            >
              {saving ? 'Adding…' : 'Add Staff'}
            </button>
            <button type="button" className="btn-back" onClick={closePanel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="page-placeholder">No staff yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOwner = r.role === 'owner'
                return (
                  <tr key={r.id}>
                    <td><strong>{r.email}</strong></td>
                    <td>{r.name}</td>
                    <td>
                      <span className={`admin-pill admin-pill-role-${r.role}`}>
                        {ROLE_LABEL[r.role] ?? r.role}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-dot ${r.active ? 'admin-dot-on' : 'admin-dot-off'}`} />
                      <span className="admin-meta" style={{ marginLeft: '0.4rem' }}>
                        {r.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="admin-cell-truncate">{r.notes || '—'}</td>
                    <td>
                      {isOwner ? (
                        <span className="admin-meta">protected</span>
                      ) : (
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => toggleActive(r)}
                          disabled={busyId === r.id}
                        >
                          {busyId === r.id ? '…' : r.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
