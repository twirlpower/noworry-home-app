import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useStaffRole } from '../../hooks/useStaffRole'

const MONTHS = [
  [1, 'January'],
  [2, 'February'],
  [3, 'March'],
  [4, 'April'],
  [5, 'May'],
  [6, 'June'],
  [7, 'July'],
  [8, 'August'],
  [9, 'September'],
  [10, 'October'],
  [11, 'November'],
  [12, 'December'],
]
const MONTH_LABEL = Object.fromEntries(MONTHS)

const FREQUENCIES = [
  ['annual', 'Annual'],
  ['biannual', 'Biannual'],
  ['quarterly', 'Quarterly'],
]

const EMPTY_FORM = {
  title: '',
  description: '',
  target_month_1: 1,
  target_month_2: '',
  frequency: 'annual',
  is_active: true,
  covered_service: false,
  notes: '',
}

// Derive a frequency label from the template's column shape — the table
// uses frequency_months (int) + target_month_2 (nullable). The admin UI
// surfaces this as a clean 'annual'/'biannual'/'quarterly' tag.
function frequencyKey(t) {
  if ((t.frequency_months ?? 12) <= 3) return 'quarterly'
  if (t.target_month_2 != null) return 'biannual'
  return 'annual'
}

function frequencyLabel(t) {
  const key = frequencyKey(t)
  return FREQUENCIES.find(([k]) => k === key)?.[1] ?? key
}

function templateToForm(t) {
  return {
    title: t.title ?? '',
    description: t.description ?? '',
    target_month_1: t.target_month_1 ?? 1,
    target_month_2: t.target_month_2 ?? '',
    frequency: frequencyKey(t),
    is_active: !!t.is_active,
    covered_service: !!t.covered_service,
    notes: t.notes ?? '',
  }
}

// Map frequency text → frequency_months int. Keeps the underlying column
// in sync without exposing it to the admin.
function freqToMonths(freq) {
  if (freq === 'quarterly') return 3
  if (freq === 'biannual') return 6
  return 12
}

export default function CRMMaintenanceTab({ onChange }) {
  const { isOwner } = useStaffRole()

  const [templates, setTemplates] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [panelMode, setPanelMode] = useState(null) // null | 'new' | <uuid>
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [regenConfirm, setRegenConfirm] = useState(false)
  const [regenBusy, setRegenBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('maintenance_templates')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setTemplates(data ?? [])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    const { data, error: e } = await supabase
      .from('maintenance_templates')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true })
    if (e) setError(e.message)
    else setTemplates(data ?? [])
  }

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setForm(EMPTY_FORM)
    setError('')
    setNotice('')
    setPanelMode('new')
  }

  function openEdit(t) {
    setForm(templateToForm(t))
    setError('')
    setNotice('')
    setPanelMode(t.id)
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
      title: form.title.trim(),
      description: form.description.trim() || null,
      target_month_1: Number(form.target_month_1) || 1,
      // Only persist target_month_2 when the frequency is actually biannual,
      // so an admin switching frequency cleans up state automatically.
      target_month_2:
        form.frequency === 'biannual' && form.target_month_2
          ? Number(form.target_month_2)
          : null,
      frequency_months: freqToMonths(form.frequency),
      is_active: form.is_active,
      covered_service: form.covered_service,
      notes: form.notes.trim() || null,
    }

    let res
    if (panelMode === 'new') {
      res = await supabase.from('maintenance_templates').insert(payload).select().single()
    } else {
      res = await supabase
        .from('maintenance_templates')
        .update(payload)
        .eq('id', panelMode)
        .select()
        .single()
    }
    if (res.error) {
      setError(res.error.message)
      setSaving(false)
      return
    }
    setSaving(false)
    setPanelMode(null)
    setNotice(panelMode === 'new' ? 'Template added.' : 'Template saved.')
    await reload()
    onChange?.()
  }

  async function toggleActive(t) {
    const { error: e } = await supabase
      .from('maintenance_templates')
      .update({ is_active: !t.is_active })
      .eq('id', t.id)
    if (e) {
      setError(e.message)
      return
    }
    await reload()
  }

  async function handleRegenerate() {
    setRegenBusy(true)
    setError('')
    setNotice('')
    const { data, error: e } = await supabase.rpc('admin_regenerate_all_maintenance')
    setRegenBusy(false)
    setRegenConfirm(false)
    if (e) {
      setError(e.message)
      return
    }
    setNotice(`Regenerated maintenance for all homes — ${data} task${data === 1 ? '' : 's'} created.`)
  }

  if (!loaded) {
    return (
      <div className="admin-loading" role="status">
        <div className="loading-spinner" />
        <p>Loading templates…</p>
      </div>
    )
  }

  return (
    <div className="admin-tab">
      <div className="admin-tab-header">
        <h2>Maintenance Templates <span className="admin-count">({templates.length})</span></h2>
        <div style={{ display: 'flex', gap: '0.7rem' }}>
          {isOwner && !regenConfirm && (
            <button
              type="button"
              className="btn-link btn-link-danger"
              onClick={() => setRegenConfirm(true)}
              disabled={regenBusy}
            >
              Regenerate maintenance for all homes
            </button>
          )}
          {panelMode === null && (
            <button className="btn-secondary" onClick={openAdd}>Add Template</button>
          )}
        </div>
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}

      {regenConfirm && (
        <div className="admin-panel" role="alert">
          <h3 className="form-subhead">Regenerate maintenance for all homes?</h3>
          <p>
            This deletes every <strong>incomplete</strong> scheduled-maintenance
            task across every home and regenerates them from the current
            active templates. Completed tasks are preserved. This cannot be
            undone.
          </p>
          <div className="admin-panel-actions">
            <button
              type="button"
              className="btn-back"
              onClick={() => setRegenConfirm(false)}
              disabled={regenBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary-full"
              onClick={handleRegenerate}
              disabled={regenBusy}
            >
              {regenBusy ? 'Regenerating…' : 'Yes, regenerate all'}
            </button>
          </div>
        </div>
      )}

      {panelMode !== null && (
        <form onSubmit={handleSave} className="admin-panel">
          <h3 className="form-subhead">
            {panelMode === 'new' ? 'New template' : 'Edit template'}
          </h3>
          <label className="form-label">
            Task name
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              required
              className="form-input"
            />
          </label>
          <label className="form-label">
            Description
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              className="form-input"
              rows={2}
            />
          </label>
          <div className="form-row form-row-3">
            <label className="form-label">
              Target month
              <select
                value={form.target_month_1}
                onChange={(e) => setField('target_month_1', e.target.value)}
                className="form-input"
              >
                {MONTHS.map(([n, l]) => (
                  <option key={n} value={n}>{l}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Second target month (biannual)
              <select
                value={form.target_month_2}
                onChange={(e) => setField('target_month_2', e.target.value)}
                className="form-input"
                disabled={form.frequency !== 'biannual'}
              >
                <option value="">— None —</option>
                {MONTHS.map(([n, l]) => (
                  <option key={n} value={n}>{l}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Frequency
              <select
                value={form.frequency}
                onChange={(e) => setField('frequency', e.target.value)}
                className="form-input"
              >
                {FREQUENCIES.map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="form-label form-checkbox">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setField('is_active', e.target.checked)}
              />
              Active
            </label>
            <label className="form-label form-checkbox">
              <input
                type="checkbox"
                checked={form.covered_service}
                onChange={(e) => setField('covered_service', e.target.checked)}
              />
              Covered service (handled by NoWorry vendor)
            </label>
          </div>
          <label className="form-label">
            Internal notes (admin only)
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
              disabled={saving || !form.title.trim()}
            >
              {saving
                ? 'Saving…'
                : panelMode === 'new'
                  ? 'Add Template'
                  : 'Save Changes'}
            </button>
            <button type="button" className="btn-back" onClick={closePanel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {templates.length === 0 ? (
        <p className="page-placeholder">No templates yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Season / Month</th>
                <th>Frequency</th>
                <th>Covered</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const m1 = t.target_month_1 ? MONTH_LABEL[t.target_month_1] : '—'
                const m2 = t.target_month_2 ? MONTH_LABEL[t.target_month_2] : null
                return (
                  <Fragment key={t.id}>
                    <tr>
                      <td>
                        <strong>{t.title}</strong>
                        {t.description && (
                          <div className="admin-meta">{t.description}</div>
                        )}
                      </td>
                      <td>{m2 ? `${m1} + ${m2}` : m1}</td>
                      <td>{frequencyLabel(t)}</td>
                      <td>{t.covered_service ? '✓' : '—'}</td>
                      <td>
                        <span className={`admin-dot ${t.is_active ? 'admin-dot-on' : 'admin-dot-off'}`} />
                        <button
                          type="button"
                          className="btn-link"
                          style={{ marginLeft: '0.4rem' }}
                          onClick={() => toggleActive(t)}
                        >
                          {t.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => openEdit(t)}
                          disabled={panelMode !== null}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
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
