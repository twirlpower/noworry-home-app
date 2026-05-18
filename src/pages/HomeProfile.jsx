import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCircle } from '../context/CircleContext'

const EMPTY = {
  address_line1: '',
  address_line2: '',
  city: '',
  state: 'CO',
  zip: '',
  year_built: '',
  square_feet: '',
  lot_size_sqft: '',
  stories: '',
  bedrooms: '',
  bathrooms: '',
  garage_type: '',
  basement: false,
  notes: '',
}

// Home pillar = Full for these roles (Family Graph permission matrix); they can
// edit. Family Member has Home = Read (view only). Other roles can't see the
// home record at all (enforced server-side by RLS, see docs/rls_policies_v1.sql).
const EDIT_ROLES = ['home_owner', 'circle_manager', 'care_partner']

function toForm(home) {
  const f = { ...EMPTY }
  for (const key of Object.keys(EMPTY)) {
    if (home[key] !== null && home[key] !== undefined) f[key] = home[key]
  }
  return f
}

export default function HomeProfile() {
  const { activeCircle, membership } = useCircle()
  const canEdit = EDIT_ROLES.includes(membership?.role)

  const [home, setHome] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeCircle) return
    let cancelled = false
    supabase
      .from('circle_homes')
      .select('is_primary, homes (*)')
      .eq('circle_id', activeCircle.id)
      .eq('status', 'active')
      .order('is_primary', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          setError(loadError.message)
        } else {
          const found = data?.[0]?.homes ?? null
          setHome(found)
          if (found) setForm(toForm(found))
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle])

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function startEdit() {
    if (home) setForm(toForm(home))
    setError('')
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setError('')
    if (home) setForm(toForm(home))
  }

  function intOrNull(v) {
    return v === '' || v === null ? null : parseInt(v, 10)
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const updates = {
      address_line1: form.address_line1,
      address_line2: form.address_line2 || null,
      city: form.city,
      state: form.state,
      zip: form.zip,
      year_built: intOrNull(form.year_built),
      square_feet: intOrNull(form.square_feet),
      lot_size_sqft: intOrNull(form.lot_size_sqft),
      stories: intOrNull(form.stories),
      bedrooms: intOrNull(form.bedrooms),
      bathrooms: form.bathrooms === '' ? null : parseFloat(form.bathrooms),
      garage_type: form.garage_type || null,
      basement: !!form.basement,
      notes: form.notes || null,
    }

    const { data, error: saveError } = await supabase
      .from('homes')
      .update(updates)
      .eq('id', home.id)
      .select()
      .single()

    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }

    setHome(data)
    setForm(toForm(data))
    setEditing(false)
    setSaving(false)
  }

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>My Home</h1>
        <p className="page-placeholder">You don't have a Home Circle yet.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p>Loading home profile…</p>
        </div>
      </div>
    )
  }

  if (!home) {
    return (
      <div className="page">
        <h1>My Home</h1>
        <p className="page-placeholder">
          No home is linked to this circle yet.
        </p>
        {error && <div className="auth-error">{error}</div>}
      </div>
    )
  }

  if (editing) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Edit Home Profile</h1>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSave} className="profile-form">
          <div className="profile-section">
            <h3>Address</h3>
            <label className="form-label">
              Street address
              <input type="text" value={form.address_line1} onChange={(e) => setField('address_line1', e.target.value)} required className="form-input" />
            </label>
            <label className="form-label">
              Apt / Unit (optional)
              <input type="text" value={form.address_line2} onChange={(e) => setField('address_line2', e.target.value)} className="form-input" />
            </label>
            <div className="form-row form-row-3">
              <label className="form-label">
                City
                <input type="text" value={form.city} onChange={(e) => setField('city', e.target.value)} required className="form-input" />
              </label>
              <label className="form-label">
                State
                <input type="text" value={form.state} onChange={(e) => setField('state', e.target.value)} required className="form-input" maxLength={2} />
              </label>
              <label className="form-label">
                Zip
                <input type="text" value={form.zip} onChange={(e) => setField('zip', e.target.value)} required className="form-input" maxLength={10} />
              </label>
            </div>
          </div>

          <div className="profile-section">
            <h3>Details</h3>
            <div className="form-row">
              <label className="form-label">
                Year built
                <input type="number" value={form.year_built} onChange={(e) => setField('year_built', e.target.value)} className="form-input" placeholder="1985" />
              </label>
              <label className="form-label">
                Square feet
                <input type="number" value={form.square_feet} onChange={(e) => setField('square_feet', e.target.value)} className="form-input" placeholder="2200" />
              </label>
            </div>
            <div className="form-row form-row-3">
              <label className="form-label">
                Bedrooms
                <input type="number" value={form.bedrooms} onChange={(e) => setField('bedrooms', e.target.value)} className="form-input" />
              </label>
              <label className="form-label">
                Bathrooms
                <input type="number" value={form.bathrooms} onChange={(e) => setField('bathrooms', e.target.value)} className="form-input" step="0.5" />
              </label>
              <label className="form-label">
                Stories
                <input type="number" value={form.stories} onChange={(e) => setField('stories', e.target.value)} className="form-input" />
              </label>
            </div>
            <div className="form-row">
              <label className="form-label">
                Lot size (sq ft)
                <input type="number" value={form.lot_size_sqft} onChange={(e) => setField('lot_size_sqft', e.target.value)} className="form-input" />
              </label>
              <label className="form-label">
                Garage
                <select value={form.garage_type} onChange={(e) => setField('garage_type', e.target.value)} className="form-input">
                  <option value="">Select…</option>
                  <option value="attached">Attached</option>
                  <option value="detached">Detached</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
            <label className="form-label form-checkbox">
              <input type="checkbox" checked={!!form.basement} onChange={(e) => setField('basement', e.target.checked)} />
              Has a basement
            </label>
            <label className="form-label">
              Notes
              <textarea value={form.notes} onChange={(e) => setField('notes', e.target.value)} className="form-input" rows={3} />
            </label>
          </div>

          <button type="submit" className="btn-primary-full" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button type="button" className="btn-back" onClick={cancelEdit} disabled={saving}>
            Cancel
          </button>
        </form>
      </div>
    )
  }

  const fullAddress = [
    home.address_line1,
    home.address_line2,
    `${home.city}, ${home.state} ${home.zip}`,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Home</h1>
        {canEdit && (
          <button className="btn-secondary" onClick={startEdit}>
            Edit
          </button>
        )}
      </div>

      <div className="profile-card">
        <h3>Address</h3>
        <p className="profile-address">{fullAddress}</p>
      </div>

      <div className="profile-card">
        <h3>Details</h3>
        <div className="detail-grid">
          <Detail label="Year built" value={home.year_built} />
          <Detail label="Square feet" value={home.square_feet && home.square_feet.toLocaleString()} />
          <Detail label="Bedrooms" value={home.bedrooms} />
          <Detail label="Bathrooms" value={home.bathrooms} />
          <Detail label="Stories" value={home.stories} />
          <Detail label="Lot size" value={home.lot_size_sqft && `${home.lot_size_sqft.toLocaleString()} sq ft`} />
          <Detail label="Garage" value={home.garage_type} />
          <Detail label="Basement" value={home.basement ? 'Yes' : 'No'} />
        </div>
        {home.notes && (
          <div className="profile-notes">
            <span className="detail-label">Notes</span>
            <p>{home.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Detail({ label, value }) {
  const display =
    value === null || value === undefined || value === '' ? '—' : value
  return (
    <div className="detail-item">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{display}</span>
    </div>
  )
}
