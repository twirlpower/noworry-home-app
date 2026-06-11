import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import './Vendors.css'

// Family-write roles for circle_vendors — mirrors the WRITE side of
// migration 045's RLS. UI-side gate; the policy is the source of truth.
const MANAGE_ROLES = ['home_owner', 'circle_manager', 'care_partner', 'care_coordinator']

// Tiers that see the "NoWorry Vetted Vendors" placeholder. 'prepared'
// (national) intentionally excluded — vetted dispatch is a regional
// service-side feature, not part of the national paid tier.
const VETTED_PLACEHOLDER_TIERS = new Set(['prepared_plus', 'covered', 'complete'])

const CATEGORIES = [
  'HVAC', 'Plumbing', 'Electrical', 'Handyman', 'Landscaping',
  'Roofing', 'Pest Control', 'Painting', 'Cleaning', 'Other',
]

const EMPTY_FORM = {
  name: '',
  category: '',
  phone: '',
  email: '',
  notes: '',
  last_used_date: '',
}

const SELECT_COLS =
  'id, circle_id, added_by_person_id, name, category, phone, email, notes, last_used_date, created_at, updated_at, deleted_at'

function rlsHint(message) {
  return /relation .* does not exist|PGRST205|schema cache/i.test(message)
    ? 'Vendor list storage is not deployed yet — run migrations/045_circle_vendors.sql in Supabase.'
    : /row-level security|permission denied/i.test(message)
      ? 'Could not load vendors — security policies for circle_vendors are not deployed. Run migrations/045_circle_vendors.sql.'
      : message
}

function vendorToForm(v) {
  return {
    name: v.name ?? '',
    category: v.category ?? '',
    phone: v.phone ?? '',
    email: v.email ?? '',
    notes: v.notes ?? '',
    last_used_date: v.last_used_date ?? '',
  }
}

function formatDate(iso) {
  if (!iso) return null
  // iso is a YYYY-MM-DD date column — render with a stable local format
  // (avoids US-only assumptions). new Date('YYYY-MM-DD') treats the input
  // as UTC midnight, which can drift one day west of UTC; split + build
  // a local Date instead.
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Vendors() {
  const { person } = useAuth()
  const { activeCircle, membership } = useCircle()
  const canManage = MANAGE_ROLES.includes(membership?.role)
  const tier = activeCircle?.subscription_tier
  const isPreparedOrBetter = tier && tier !== 'aware'
  const showsVettedPlaceholder = VETTED_PLACEHOLDER_TIERS.has(tier)

  const [vendors, setVendors] = useState([])
  const [loadedFor, setLoadedFor] = useState(null)
  const loading = !!activeCircle && isPreparedOrBetter && loadedFor !== activeCircle.id

  const [editingId, setEditingId] = useState(null) // null | 'new' | <uuid>
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
      .from('circle_vendors')
      .select(SELECT_COLS)
      .eq('circle_id', circleId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) {
          setError(rlsHint(e.message))
          setVendors([])
        } else {
          setError('')
          setVendors(data ?? [])
        }
        setLoadedFor(circleId)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle, isPreparedOrBetter])

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

  function openEdit(v) {
    setForm(vendorToForm(v))
    setError('')
    setNotice('')
    setConfirmDeleteId(null)
    setEditingId(v.id)
  }

  function closeForm() {
    setEditingId(null)
    setError('')
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!canManage) {
      console.warn('[Vendors] save blocked: role', membership?.role)
      return
    }
    setError('')
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      category: form.category || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
      last_used_date: form.last_used_date || null,
    }

    if (editingId === 'new') {
      const { data, error: saveErr } = await supabase
        .from('circle_vendors')
        .insert({
          ...payload,
          circle_id: activeCircle.id,
          added_by_person_id: person?.id ?? null,
        })
        .select(SELECT_COLS)
        .maybeSingle()
      if (saveErr) {
        setError(rlsHint(saveErr.message))
        setSaving(false)
        return
      }
      if (!data) {
        setError('Could not save the vendor — please try again.')
        setSaving(false)
        return
      }
      setVendors((prev) => [data, ...prev])
      setNotice(`Added ${data.name}.`)
    } else {
      const { error: saveErr } = await supabase
        .from('circle_vendors')
        .update(payload)
        .eq('id', editingId)
      if (saveErr) {
        setError(rlsHint(saveErr.message))
        setSaving(false)
        return
      }
      setVendors((prev) =>
        prev.map((v) => (v.id === editingId ? { ...v, ...payload } : v))
      )
      setNotice(`Updated ${payload.name}.`)
    }

    setSaving(false)
    setEditingId(null)
  }

  // Soft delete — UPDATE deleted_at = now(). Migration 045 grants UPDATE
  // (not DELETE) for the family-write roles, so this is the path the RLS
  // policy expects. Optimistic remove from the list; on error reload.
  async function handleSoftDelete(v) {
    if (!canManage) {
      console.warn('[Vendors] delete blocked: role', membership?.role)
      return
    }
    setConfirmDeleteId(null)
    setError('')
    const removed = v
    setVendors((prev) => prev.filter((x) => x.id !== v.id))

    const { error: delErr } = await supabase
      .from('circle_vendors')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', v.id)

    if (delErr) {
      setError(rlsHint(delErr.message))
      setVendors((prev) => [removed, ...prev]) // restore in place
      return
    }
    setNotice(`Removed ${v.name}.`)
  }

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>My Vendors</h1>
        <p className="page-placeholder">You don't have a Home Circle yet.</p>
      </div>
    )
  }

  // Tier gate — Aware sees an upgrade prompt; everyone else gets the page.
  if (!isPreparedOrBetter) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>My Vendors</h1>
        </div>
        <div className="ec-upgrade">
          <h2 className="ec-upgrade-title">Your Vendors is a Prepared feature</h2>
          <p className="ec-upgrade-body">
            Upgrade to keep your trusted contacts organized — the people who
            know your home — and share them with your whole family.
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
          <p>Loading vendors…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Vendors</h1>
        {canManage && editingId === null && (
          <button className="btn-secondary" onClick={openAdd}>
            Add Vendor
          </button>
        )}
      </div>

      {membership?.role === 'view_only' && (
        <p className="page-placeholder">
          You have view-only access to this home.
        </p>
      )}

      <p className="page-placeholder">
        Your trusted contacts — shared with your whole family circle.
      </p>

      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}

      {editingId !== null && (
        <form onSubmit={handleSave} className="profile-section">
          <h3 className="form-subhead">
            {editingId === 'new' ? 'Add a vendor' : 'Edit vendor'}
          </h3>
          <label className="form-label">
            Name
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              required
              className="form-input"
              placeholder="Joe's HVAC · Maria, our handyman"
              autoComplete="name"
            />
          </label>
          <label className="form-label">
            Category
            <select
              value={form.category}
              onChange={(e) => setField('category', e.target.value)}
              className="form-input"
            >
              <option value="">Choose a category…</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
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
                placeholder="joe@example.com"
                autoComplete="email"
              />
            </label>
          </div>
          <label className="form-label">
            Last used (optional)
            <input
              type="date"
              value={form.last_used_date}
              onChange={(e) => setField('last_used_date', e.target.value)}
              className="form-input"
            />
          </label>
          <label className="form-label">
            Notes (optional)
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className="form-input"
              rows={3}
              placeholder="Best times to call, ask for John, anything helpful."
            />
          </label>
          <button
            type="submit"
            className="btn-primary-full"
            disabled={saving || !form.name.trim()}
          >
            {saving ? 'Saving…' : editingId === 'new' ? 'Add Vendor' : 'Save Changes'}
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

      <section aria-labelledby="vendors-h">
        <h2 id="vendors-h" className="form-subhead">Your Vendors</h2>
        <div className="profile-card">
          {vendors.length === 0 ? (
            <p className="page-placeholder">
              {canManage
                ? 'Add the people who know your home. Your family can see them too.'
                : 'No vendors have been added for this circle yet.'}
            </p>
          ) : (
            <ul className="systems-list">
              {vendors.map((v) => {
                const confirming = confirmDeleteId === v.id
                return (
                  <li key={v.id} className="ec-row">
                    <div className="ec-body">
                      <span className="ec-name">{v.name}</span>
                      {v.category && (
                        <span className="ec-relationship">{v.category}</span>
                      )}
                      {v.phone && (
                        <div className="ec-contact-line">
                          <a href={`tel:${v.phone.replace(/[^+\d]/g, '')}`}>{v.phone}</a>
                        </div>
                      )}
                      {v.email && (
                        <div className="ec-contact-line">
                          <a href={`mailto:${v.email}`}>{v.email}</a>
                        </div>
                      )}
                      {v.last_used_date && (
                        <div className="ec-contact-line">
                          Last used: {formatDate(v.last_used_date)}
                        </div>
                      )}
                      {v.notes && <div className="ec-notes">{v.notes}</div>}
                    </div>

                    <div className="ec-actions">
                      {canManage && !confirming && (
                        <div className="ec-row-links">
                          <button
                            className="btn-link"
                            onClick={() => openEdit(v)}
                            aria-label={`Edit ${v.name}`}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-link btn-link-danger"
                            onClick={() => setConfirmDeleteId(v.id)}
                            aria-label={`Remove ${v.name}`}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                      {canManage && confirming && (
                        <div className="ec-confirm-delete" role="alert">
                          <span>Remove {v.name}?</span>
                          <div className="ec-confirm-delete-buttons">
                            <button
                              className="btn-link"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn-link btn-link-danger"
                              onClick={() => handleSoftDelete(v)}
                            >
                              Yes, remove
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
      </section>

      {showsVettedPlaceholder && (
        <section aria-labelledby="vetted-h" className="vendors-vetted">
          <h2 id="vetted-h" className="form-subhead">NoWorry Vetted Vendors</h2>
          <div className="vendors-vetted-card">
            <p>
              Vetted vendors with member pricing are coming soon in your area.
              When your market goes live, you'll have access to our trusted
              network — at rates below what you'd pay on your own.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
