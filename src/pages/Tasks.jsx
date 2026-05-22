import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'

const NOTE_PREVIEW_CHARS = 80
const NOTES_FEED_LIMIT = 50

function notePreview(text) {
  if (!text) return ''
  if (text.length <= NOTE_PREVIEW_CHARS) return text
  return text.slice(0, NOTE_PREVIEW_CHARS).trimEnd() + '…'
}

function formatNoteDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

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
  const tier = activeCircle?.subscription_tier
  const isPreparedOrBetter = tier && tier !== 'aware'

  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [notes, setNotes] = useState([])
  // Derived loading flag (no setState in effect body — strict ruleset).
  const [loadedFor, setLoadedFor] = useState(null)
  const loading = !!activeCircle && isPreparedOrBetter && loadedFor !== activeCircle.id

  const [editingId, setEditingId] = useState(null) // null | 'new' | <uuid>
  const [expandedId, setExpandedId] = useState(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)

  // ── Family Notes feed (separate input + posting state) ────────────────────
  const [noteDraft, setNoteDraft] = useState('')
  const [postingNote, setPostingNote] = useState(false)
  const [noteError, setNoteError] = useState('')

  useEffect(() => {
    if (!activeCircle || !isPreparedOrBetter) return
    let cancelled = false
    const circleId = activeCircle.id

    // Three parallel reads. tasks: embed assignee via the FK column name so
    // PostgREST disambiguates assigned_to vs created_by (PGRST201, same
    // pattern as 72e6eb8 on circle_memberships). members: only 'active'
    // memberships are assignable; 'invited' rows belong on the Circle page.
    // notes: family-notes feed (migration 020); embed author for display.
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
      supabase
        .from('notes')
        .select('id, content, created_at, author:persons!author_id (id, first_name, last_name)')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(NOTES_FEED_LIMIT),
    ]).then(([taskRes, memberRes, notesRes]) => {
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
      // Notes failures shouldn't break the tasks page — surface inline.
      if (notesRes.error) {
        setNoteError(notesRes.error.message?.match(/row-level security|permission denied/i)
          ? 'The notes security policy is not deployed. Run migrations/020_notes_rls.sql in Supabase.'
          : notesRes.error.message)
        setNotes([])
      } else {
        setNoteError('')
        setNotes(notesRes.data ?? [])
      }
      setLoadedFor(circleId)
    })

    return () => {
      cancelled = true
    }
  }, [activeCircle, isPreparedOrBetter])

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

  // Soft-cancel: migration 009 deliberately has no DELETE policy. We set
  // status='cancelled' and rely on the existing .neq('status','cancelled')
  // filter to drop it from the visible list.
  async function removeTask(t) {
    setConfirmRemoveId(null)
    setExpandedId(null)
    const { error: e } = await supabase
      .from('tasks')
      .update({ status: 'cancelled' })
      .eq('id', t.id)
    if (e) {
      setError(rlsHint(e.message))
      return
    }
    setNotice(`Removed "${t.title}".`)
    await reloadTasks()
  }

  async function postNote(e) {
    e.preventDefault()
    const content = noteDraft.trim()
    if (!content) return
    setPostingNote(true)
    setNoteError('')
    const { data, error: insErr } = await supabase
      .from('notes')
      .insert({
        circle_id: activeCircle.id,
        author_id: person.id,
        content,
      })
      .select('id, content, created_at, author:persons!author_id (id, first_name, last_name)')
      .single()
    if (insErr) {
      setNoteError(rlsHint(insErr.message))
      setPostingNote(false)
      return
    }
    setNotes((prev) => [data, ...prev])
    setNoteDraft('')
    setPostingNote(false)
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

  // Aware-tier upgrade gate — Prepared feature. Sends users back to /dashboard
  // where PreparedReveal owns the conversion moment (same pattern as
  // EmergencyContacts).
  if (!isPreparedOrBetter) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Tasks</h1>
        </div>
        <div className="ec-upgrade">
          <h2 className="ec-upgrade-title">
            Stay on top of what needs doing — together.
          </h2>
          <p className="ec-upgrade-body">
            Task management is part of your Prepared plan. Coordinate repairs,
            errands, and to-dos with your family in one shared list.
          </p>
          <Link to="/dashboard" className="btn-primary-full">
            Try Prepared free for 30 days →
          </Link>
        </div>
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
      {notice && <div className="auth-notice" role="status">{notice}</div>}

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
            Notes (optional)
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
            No tasks yet. Add your first one — whether it's a repair to
            schedule, a document to find, or something to talk about at the
            next visit.
          </p>
        ) : (
          <ul className="task-list">
            {open.map((t) => {
              const due = formatDue(t.due_date)
              const isExpanded = expandedId === t.id
              const isConfirming = confirmRemoveId === t.id
              const preview = notePreview(t.description)
              return (
                <li key={t.id} className="task-item">
                  <div className="task-row">
                    <label className="task-checkbox" aria-label={`Mark "${t.title}" complete`}>
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => markComplete(t)}
                        disabled={!canActOn(t)}
                      />
                    </label>
                    <button
                      type="button"
                      className="task-body"
                      onClick={() => setExpandedId(isExpanded ? null : t.id)}
                      aria-expanded={isExpanded}
                    >
                      <span className="task-title">{t.title}</span>
                      <span className="task-meta">
                        {assigneeName(t)}
                        {due && (
                          <>
                            {' · '}
                            <span className={due.overdue ? 'task-due-overdue' : ''}>{due.label}</span>
                          </>
                        )}
                        {t.priority !== 'medium' && (
                          ` · ${PRIORITIES.find(([v]) => v === t.priority)?.[1]} priority`
                        )}
                      </span>
                      {preview && (
                        <span className="task-preview">{preview}</span>
                      )}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="task-expand">
                      {t.description && (
                        <p className="task-expand-notes">{t.description}</p>
                      )}
                      <div className="task-expand-actions">
                        {canManage && editingId === null && !isConfirming && (
                          <button className="btn-link" onClick={() => openEdit(t)}>
                            Edit
                          </button>
                        )}
                        {canManage && !isConfirming && (
                          <button
                            className="btn-link btn-link-danger"
                            onClick={() => setConfirmRemoveId(t.id)}
                          >
                            Remove
                          </button>
                        )}
                        {isConfirming && (
                          <span className="task-confirm" role="alert">
                            Remove this task?
                            <button
                              className="btn-link"
                              onClick={() => setConfirmRemoveId(null)}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn-link btn-link-danger"
                              onClick={() => removeTask(t)}
                            >
                              Yes, remove
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  )}
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
            <ul className="task-list">
              {completed.map((t) => (
                <li key={t.id} className="task-item task-completed">
                  <div className="task-row">
                    <label className="task-checkbox" aria-label={`Reopen "${t.title}"`}>
                      <input
                        type="checkbox"
                        checked={true}
                        onChange={() => reopenTask(t)}
                        disabled={!canActOn(t)}
                      />
                    </label>
                    <div className="task-body task-body-static">
                      <span className="task-title">{t.title}</span>
                      <span className="task-meta">
                        {assigneeName(t)}
                        {' · Completed'}
                        {t.completed_at && (
                          ' · ' + new Date(t.completed_at).toLocaleDateString()
                        )}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Family Notes feed — append-only, separate notes table (migration 020). */}
      <div className="profile-card">
        <h3>Family Notes</h3>
        <p className="page-placeholder">Leave a note for your circle.</p>

        {noteError && <div className="auth-error" role="alert">{noteError}</div>}

        {canManage && (
          <form onSubmit={postNote} className="note-form">
            <label className="sr-only" htmlFor="note-draft">New family note</label>
            <textarea
              id="note-draft"
              className="form-input"
              rows={3}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="A quick update, a question, something to remember…"
              disabled={postingNote}
            />
            <button
              type="submit"
              className="btn-secondary"
              disabled={postingNote || !noteDraft.trim()}
            >
              {postingNote ? 'Posting…' : 'Post'}
            </button>
          </form>
        )}

        {notes.length === 0 ? (
          <p className="page-placeholder">No notes yet. Leave a note for your family.</p>
        ) : (
          <ul className="note-feed">
            {notes.map((n) => {
              const authorName = n.author
                ? `${n.author.first_name} ${n.author.last_name}`.trim()
                : 'A circle member'
              return (
                <li key={n.id} className="note-item">
                  <div className="note-header">
                    <span className="note-author">{authorName}</span>
                    <span className="note-date">{formatNoteDate(n.created_at)}</span>
                  </div>
                  <p className="note-content">{n.content}</p>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
