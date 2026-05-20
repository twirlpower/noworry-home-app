import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCircle } from '../context/CircleContext'
import './EmergencyContacts.css'

// Family-write roles per the Family Graph matrix — same set used by tasks,
// documents, and migration 013's INSERT/UPDATE/DELETE checks. Spec proposed
// circle_manager only; widened here for matrix consistency (a care_partner
// often maintains a senior parent's contacts).
const MANAGE_ROLES = ['home_owner', 'circle_manager', 'care_partner']

const EMPTY_FORM = {
  // Spec said "label"; real column is `relationship` (schema v1.0 L459).
  // Same semantics, just the column name diverges.
  relationship: '',
  name: '',
  phone: '',
  email: '',
  notes: '',
}

const SELECT_COLS =
  'id, circle_id, name, relationship, phone, email, priority_order, notes, is_primary, created_at'

function rlsHint(message) {
  return /row-level security|permission denied/i.test(message)
    ? 'Could not load contacts — the emergency_contacts security policy is not deployed. Run migrations/013_emergency_contacts_rls.sql in Supabase.'
    : message
}

function contactToForm(c) {
  return {
    relationship: c.relationship ?? '',
    name: c.name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    notes: c.notes ?? '',
  }
}

export default function EmergencyContacts() {
  const { activeCircle, membership } = useCircle()
  const canManage = MANAGE_ROLES.includes(membership?.role)
  const tier = activeCircle?.subscription_tier
  const isPreparedOrBetter = tier && tier !== 'aware'

  const [contacts, setContacts] = useState([])
  // Derived loading — strict lint forbids setState in effect body.
  const [loadedFor, setLoadedFor] = useState(null)
  const loading = !!activeCircle && isPreparedOrBetter && loadedFor !== activeCircle.id

  const [editingId, setEditingId] = useState(null)  // null | 'new' | <uuid>
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  useEffect(() => {
    if (!activeCircle || !isPreparedOrBetter) return
    let cancelled = false
    const circleId = activeCircle.id
    supabase
      .from('emergency_contacts')
      .select(SELECT_COLS)
      .eq('circle_id', circleId)
      .order('priority_order', { ascending: true })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) {
          setError(rlsHint(e.message))
          setContacts([])
        } else {
          setError('')
          setContacts(data ?? [])
        }
        setLoadedFor(circleId)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle, isPreparedOrBetter])

  async function reload() {
    const { data, error: e } = await supabase
      .from('emergency_contacts')
      .select(SELECT_COLS)
      .eq('circle_id', activeCircle.id)
      .order('priority_order', { ascending: true })
    if (e) setError(rlsHint(e.message))
    else setContacts(data ?? [])
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function openAdd() {
    setForm(EMPTY_FORM)
    setError('')
    setNotice('')
    setConfirmDeleteId(null)
    setEditingId('new')
  }

  function openEdit(c) {
    setForm(contactToForm(c))
    setError('')
    setNotice('')
    setConfirmDeleteId(null)
    setEditingId(c.id)
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
      name: form.name.trim(),
      relationship: form.relationship.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
    }

    if (editingId === 'new') {
      // priority_order = max(existing) + 1, so new contacts land at the end.
      const maxOrder = contacts.reduce((m, c) => Math.max(m, c.priority_order ?? 0), 0)
      const { data, error: saveErr } = await supabase
        .from('emergency_contacts')
        .insert({
          ...payload,
          circle_id: activeCircle.id,
          priority_order: maxOrder + 1,
        })
        .select(SELECT_COLS)
        .single()
      if (saveErr) {
        setError(rlsHint(saveErr.message))
        setSaving(false)
        return
      }
      setContacts((prev) => [...prev, data])
      setNotice(`Added ${data.name}.`)
    } else {
      const { error: saveErr } = await supabase
        .from('emergency_contacts')
        .update(payload)
        .eq('id', editingId)
      if (saveErr) {
        setError(rlsHint(saveErr.message))
        setSaving(false)
        return
      }
      setContacts((prev) =>
        prev.map((c) => (c.id === editingId ? { ...c, ...payload } : c))
      )
      setNotice(`Updated ${payload.name}.`)
    }

    setSaving(false)
    setEditingId(null)
  }

  // Optimistic delete + re-numbering of higher-priority rows. On any DB
  // error we reload from source-of-truth rather than try to surgically undo.
  async function handleDelete(c) {
    setConfirmDeleteId(null)
    setError('')

    const removedOrder = c.priority_order
    const optimistic = contacts
      .filter((x) => x.id !== c.id)
      .map((x) =>
        x.priority_order > removedOrder ? { ...x, priority_order: x.priority_order - 1 } : x
      )
    setContacts(optimistic)

    const { error: delErr } = await supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', c.id)
    if (delErr) {
      setError(rlsHint(delErr.message))
      await reload()
      return
    }

    // Renumber the rows that were above the deleted one. Sequential update
    // is fine — emergency_contacts has no unique constraint on
    // (circle_id, priority_order), so transient duplicates don't violate.
    const affected = contacts.filter(
      (x) => x.id !== c.id && x.priority_order > removedOrder
    )
    for (const a of affected) {
      const { error: upErr } = await supabase
        .from('emergency_contacts')
        .update({ priority_order: a.priority_order - 1 })
        .eq('id', a.id)
      if (upErr) {
        setError(rlsHint(upErr.message))
        await reload()
        return
      }
    }
    setNotice(`Removed ${c.name}.`)
  }

  // Swap with neighbor. Optimistic locally, then two DB updates. No unique
  // constraint on (circle_id, priority_order), so a transient tied value
  // between writes is safe.
  async function move(c, direction) {
    const idx = contacts.findIndex((x) => x.id === c.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= contacts.length) return

    const other = contacts[swapIdx]
    const optimistic = [...contacts]
    optimistic[idx] = { ...c, priority_order: other.priority_order }
    optimistic[swapIdx] = { ...other, priority_order: c.priority_order }
    optimistic.sort((a, b) => a.priority_order - b.priority_order)
    setContacts(optimistic)

    const [r1, r2] = await Promise.all([
      supabase.from('emergency_contacts').update({ priority_order: other.priority_order }).eq('id', c.id),
      supabase.from('emergency_contacts').update({ priority_order: c.priority_order }).eq('id', other.id),
    ])
    if (r1.error || r2.error) {
      setError(rlsHint((r1.error || r2.error).message))
      await reload()
    }
  }

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Emergency Contacts</h1>
        <p className="page-placeholder">You don't have a Home Circle yet.</p>
      </div>
    )
  }

  // Tier gate. Spec said "reuse PreparedReveal or a simple inline card" —
  // simple card here, since the full reveal lives on Dashboard. Sending
  // users back there keeps the conversion moment in one place.
  if (!isPreparedOrBetter) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Emergency Contacts</h1>
        </div>
        <div className="ec-upgrade">
          <h2 className="ec-upgrade-title">Emergency Contacts is part of Prepared</h2>
          <p className="ec-upgrade-body">
            Keep a prioritized list of the people your family should reach first
            — doctors, neighbors, attorney. It's free for 30 days, no card needed.
          </p>
          <Link to="/dashboard" className="btn-primary-full">
            Start your free trial →
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
          <p>Loading contacts…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Emergency Contacts</h1>
        {canManage && editingId === null && (
          <button className="btn-secondary" onClick={openAdd}>
            Add Contact
          </button>
        )}
      </div>

      <p className="page-placeholder">
        The people your family should call first — in the right order.
      </p>

      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}

      {editingId !== null && (
        <form onSubmit={handleSave} className="profile-section">
          <h3 className="form-subhead">
            {editingId === 'new' ? 'Add a contact' : 'Edit contact'}
          </h3>
          <label className="form-label">
            Name
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              required
              className="form-input"
              placeholder="Jane Smith"
              autoComplete="name"
            />
          </label>
          <label className="form-label">
            Relationship or role
            <input
              type="text"
              value={form.relationship}
              onChange={(e) => setField('relationship', e.target.value)}
              className="form-input"
              placeholder="Primary Physician · Daughter · Attorney"
            />
          </label>
          <div className="form-row">
            <label className="form-label">
              Phone
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                className="form-input"
                placeholder="(303) 555-0142"
                autoComplete="tel"
              />
            </label>
            <label className="form-label">
              Email (optional)
              <input
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                className="form-input"
                placeholder="jane@example.com"
                autoComplete="email"
              />
            </label>
          </div>
          <label className="form-label">
            Notes (optional)
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className="form-input"
              rows={2}
              placeholder="When to call, after-hours line, anything else helpful."
            />
          </label>
          <button
            type="submit"
            className="btn-primary-full"
            disabled={saving || !form.name.trim()}
          >
            {saving ? 'Saving…' : editingId === 'new' ? 'Add Contact' : 'Save Changes'}
          </button>
          <button
            type="button"
            className="btn-back"
            onClick={closeForm}
            disabled={saving}
          >
            Cancel
          </button>
        </form>
      )}

      <div className="profile-card">
        {contacts.length === 0 ? (
          <p className="page-placeholder">
            {canManage
              ? 'No emergency contacts yet. Add the people your family should reach first.'
              : 'No emergency contacts have been added for this circle yet.'}
          </p>
        ) : (
          <ul className="systems-list">
            {contacts.map((c, idx) => {
              const isFirst = idx === 0
              const isLast = idx === contacts.length - 1
              const confirming = confirmDeleteId === c.id

              return (
                <li key={c.id} className="ec-row">
                  <div className="ec-priority" aria-label={`Priority ${idx + 1}`}>
                    {idx + 1}
                  </div>
                  <div className="ec-body">
                    <span className="ec-name">{c.name}</span>
                    {c.relationship && (
                      <span className="ec-relationship">{c.relationship}</span>
                    )}
                    {c.phone && (
                      <div className="ec-contact-line">
                        <a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>{c.phone}</a>
                      </div>
                    )}
                    {c.email && (
                      <div className="ec-contact-line">
                        <a href={`mailto:${c.email}`}>{c.email}</a>
                      </div>
                    )}
                    {c.notes && <div className="ec-notes">{c.notes}</div>}
                  </div>

                  <div className="ec-actions">
                    {canManage && !confirming && (
                      <>
                        <div className="ec-reorder">
                          <button
                            type="button"
                            className="ec-arrow"
                            onClick={() => move(c, 'up')}
                            disabled={isFirst}
                            aria-label={`Move ${c.name} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="ec-arrow"
                            onClick={() => move(c, 'down')}
                            disabled={isLast}
                            aria-label={`Move ${c.name} down`}
                          >
                            ↓
                          </button>
                        </div>
                        <div className="ec-row-links">
                          <button
                            className="btn-link"
                            onClick={() => openEdit(c)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-link btn-link-danger"
                            onClick={() => setConfirmDeleteId(c.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                    {canManage && confirming && (
                      <div className="ec-confirm-delete" role="alert">
                        <span>Delete {c.name}?</span>
                        <div className="ec-confirm-delete-buttons">
                          <button
                            className="btn-link"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn-link btn-link-danger"
                            onClick={() => handleDelete(c)}
                          >
                            Yes, delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
