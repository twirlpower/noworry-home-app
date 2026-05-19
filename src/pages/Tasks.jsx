import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'

// Family pillar = Full → may create / edit any task. The assignee can update
// their own task (e.g. mark complete) even without these roles — enforced
// server-side by tasks_update in migrations/009_tasks_rls.sql.
const MANAGE_ROLES = ['home_owner', 'circle_manager', 'care_partner']

const PRIORITIES = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
]

const STATUS_LABELS = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  complete: 'Complete',
  cancelled: 'Cancelled',
}

const EMPTY_FORM = {
  title: '',
  description: '',
  assigned_to: '',
  due_date: '',
  priority: 'medium',
}

function rlsHint(message) {
  return /row-level security|permission denied/i.test(message)
    ? 'Could not save — the tasks security policy is not deployed. Run migrations/009_tasks_rls.sql in Supabase.'
    : message
}

// Plain-English due-date relative to today, senior-first ("Overdue 3 days"
// reads more clearly than a colored badge alone).
function formatDue(dateStr) {
  if (!dateStr) return null
  const due = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((due - today) / 86400000)
  if (days < 0) return { label: `Overdue ${-days} day${days === -1 ? '' : 's'}`, overdue: true }
  if (days === 0) return { label: 'Due today', overdue: false }
  if (days === 1) return { label: 'Due tomorrow', overdue: false }
  if (days <= 7) return { label: `Due in ${days} days`, overdue: false }
  return {
    label: 'Due ' + due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    overdue: false,
  }
}

function taskToForm(t) {
  return {
    title: t.title ?? '',
    description: t.description ?? '',
    assigned_to: t.assigned_to ?? '',
    due_date: t.due_date ?? '',
    priority: t.priority ?? 'medium',
  }
}

export default function Tasks() {
  const { person } = useAuth()
  const { activeCircle, membership } = useCircle()
  const canManage = MANAGE_ROLES.includes(membership?.role)

  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  // Derived loading flag (no setState in effect body — strict ruleset).
  const [loadedFor, setLoadedFor] = useState(null)
  const loading = !!activeCircle && loadedFor !== activeCircle.id

  const [editingId, setEditingId] = useState(null) // null | 'new' | <uuid>
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    if (!activeCircle) return
    let cancelled = false
    const circleId = activeCircle.id

    // Two parallel reads. tasks: embed assignee via the FK column name so
    // PostgREST disambiguates assigned_to vs created_by (PGRST201, same
    // pattern as 72e6eb8 on circle_memberships). members: only 'active'
    // memberships are assignable; 'invited' rows belong on the Circle page.
    Promise.all([
      supabase
        .from('tasks')
        .select(
          'id, title, description, status, priority, due_date, assigned_to, created_by, completed_at, ' +
          'assignee:persons!assigned_to (first_name, last_name)'
        )
        .eq('circle_id', circleId)
        .neq('status', 'cancelled')
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('circle_memberships')
        .select('persons!person_id (id, first_name, last_name)')
        .eq('circle_id', circleId)
        .eq('status', 'active'),
    ]).then(([taskRes, memberRes]) => {
      if (cancelled) return
      if (taskRes.error) {
        setError(rlsHint(taskRes.error.message))
        setTasks([])
      } else {
        setError('')
        setTasks(taskRes.data ?? [])
      }
      const ppl = (memberRes.data ?? [])
        .map((m) => m.persons)
        .filter(Boolean)
      setMembers(ppl)
      setLoadedFor(circleId)
    })

    return () => {
      cancelled = true
    }
  }, [activeCircle])

  async function reloadTasks() {
    const { data, error: e } = await supabase
      .from('tasks')
      .select(
        'id, title, description, status, priority, due_date, assigned_to, created_by, completed_at, ' +
        'assignee:persons!assigned_to (first_name, last_name)'
      )
      .eq('circle_id', activeCircle.id)
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true, nullsFirst: false })
    if (e) setError(rlsHint(e.message))
    else setTasks(data ?? [])
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function openAdd() {
    setForm(EMPTY_FORM)
    setError('')
    setEditingId('new')
  }

  function openEdit(t) {
    setForm(taskToForm(t))
    setError('')
    setEditingId(t.id)
  }

  function closeForm() {
    setEditingId(null)
    setError('')
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      assigned_to: form.assigned_to || null,
      due_date: form.due_date || null,
      priority: form.priority,
    }

    let res
    if (editingId === 'new') {
      // status auto-derived on create: open if unassigned, assigned otherwise.
      // Edits leave status alone — use Mark complete / Reopen for transitions.
      res = await supabase.from('tasks').insert({
        ...payload,
        circle_id: activeCircle.id,
        created_by: person.id,
        status: payload.assigned_to ? 'assigned' : 'open',
      })
    } else {
      res = await supabase.from('tasks').update(payload).eq('id', editingId)
    }

    if (res.error) {
      setError(rlsHint(res.error.message))
      setSaving(false)
      return
    }

    setSaving(false)
    setEditingId(null)
    await reloadTasks()
  }

  async function markComplete(t) {
    const { error: e } = await supabase
      .from('tasks')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        completed_by: person.id,
      })
      .eq('id', t.id)
    if (e) {
      setError(rlsHint(e.message))
      return
    }
    await reloadTasks()
  }

  async function reopenTask(t) {
    const { error: e } = await supabase
      .from('tasks')
      .update({
        status: t.assigned_to ? 'assigned' : 'open',
        completed_at: null,
        completed_by: null,
      })
      .eq('id', t.id)
    if (e) {
      setError(rlsHint(e.message))
      return
    }
    await reloadTasks()
  }

  function assigneeName(t) {
    if (!t.assignee) return 'Unassigned'
    return `${t.assignee.first_name} ${t.assignee.last_name}`.trim()
  }

  function canActOn(t) {
    return canManage || t.assigned_to === person?.id
  }

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Tasks</h1>
        <p className="page-placeholder">You don't have a Home Circle yet.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen" role="status">
          <div className="loading-spinner" />
          <p>Loading tasks…</p>
        </div>
      </div>
    )
  }

  const open = tasks.filter((t) => t.status !== 'complete')
  const completed = tasks.filter((t) => t.status === 'complete')

  return (
    <div className="page">
      <div className="page-header">
        <h1>Tasks</h1>
        {canManage && editingId === null && (
          <button className="btn-secondary" onClick={openAdd}>
            Add Task
          </button>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {editingId !== null && (
        <form onSubmit={handleSave} className="profile-section">
          <h3 className="form-subhead">
            {editingId === 'new' ? 'New task' : 'Edit task'}
          </h3>
          <label className="form-label">
            Title
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              required
              className="form-input"
              placeholder="Schedule furnace tune-up"
            />
          </label>
          <label className="form-label">
            Description (optional)
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              className="form-input"
              rows={3}
            />
          </label>
          <div className="form-row form-row-3">
            <label className="form-label">
              Assign to
              <select
                value={form.assigned_to}
                onChange={(e) => setField('assigned_to', e.target.value)}
                className="form-input"
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.first_name} {m.last_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Due date
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setField('due_date', e.target.value)}
                className="form-input"
              />
            </label>
            <label className="form-label">
              Priority
              <select
                value={form.priority}
                onChange={(e) => setField('priority', e.target.value)}
                className="form-input"
              >
                {PRIORITIES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="btn-primary-full" disabled={saving || !form.title.trim()}>
            {saving ? 'Saving…' : editingId === 'new' ? 'Add Task' : 'Save Changes'}
          </button>
          <button type="button" className="btn-back" onClick={closeForm} disabled={saving}>
            Cancel
          </button>
        </form>
      )}

      <div className="profile-card">
        <h3>Open ({open.length})</h3>
        {open.length === 0 ? (
          <p className="page-placeholder">
            {canManage
              ? 'No open tasks. Add one to coordinate with your family.'
              : 'No open tasks for this circle.'}
          </p>
        ) : (
          <ul className="systems-list">
            {open.map((t) => {
              const due = formatDue(t.due_date)
              return (
                <li key={t.id} className="system-row">
                  <div className="system-main">
                    <span className="system-name">{t.title}</span>
                    <span className="system-meta">
                      {assigneeName(t)}
                      {' · '}
                      {STATUS_LABELS[t.status] ?? t.status}
                      {t.priority !== 'medium' && ` · ${PRIORITIES.find(([v]) => v === t.priority)?.[1]} priority`}
                      {due && (
                        <>
                          {' · '}
                          <span className={due.overdue ? 'task-due-overdue' : ''}>{due.label}</span>
                        </>
                      )}
                    </span>
                    {t.description && (
                      <span className="system-meta task-desc">{t.description}</span>
                    )}
                  </div>
                  <div className="system-actions">
                    {canActOn(t) && (
                      <button className="btn-link" onClick={() => markComplete(t)}>
                        Mark complete
                      </button>
                    )}
                    {canManage && editingId === null && (
                      <button className="btn-link" onClick={() => openEdit(t)}>
                        Edit
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {completed.length > 0 && (
        <div className="profile-card">
          <div className="card-header">
            <h3>Completed ({completed.length})</h3>
            <button
              className="btn-link"
              onClick={() => setShowCompleted((v) => !v)}
            >
              {showCompleted ? 'Hide' : 'Show'}
            </button>
          </div>
          {showCompleted && (
            <ul className="systems-list">
              {completed.map((t) => (
                <li key={t.id} className="system-row">
                  <div className="system-main">
                    <span className="system-name">{t.title}</span>
                    <span className="system-meta">
                      {assigneeName(t)}
                      {' · Completed'}
                      {t.completed_at && (
                        ' · ' + new Date(t.completed_at).toLocaleDateString()
                      )}
                    </span>
                  </div>
                  {canActOn(t) && (
                    <div className="system-actions">
                      <button className="btn-link" onClick={() => reopenTask(t)}>
                        Reopen
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
