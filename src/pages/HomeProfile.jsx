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
// home record at all (enforced server-side by RLS, see migrations/rls_policies_v1.sql).
const EDIT_ROLES = ['home_owner', 'circle_manager', 'care_partner']

const SYSTEM_TYPES = [
  ['hvac', 'HVAC'],
  ['water_heater', 'Water heater'],
  ['plumbing', 'Plumbing'],
  ['electrical', 'Electrical'],
  ['roof', 'Roof'],
  ['foundation', 'Foundation'],
  ['appliance', 'Appliance'],
  ['security', 'Security'],
  ['garage', 'Garage'],
  ['other', 'Other'],
]

const SYS_EMPTY = {
  system_type: '',
  name: '',
  brand: '',
  model: '',
  install_date: '',
  location_in_home: '',
  notes: '',
}

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
  const [systems, setSystems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sysEditId, setSysEditId] = useState(null) // null=closed, 'new'=add, <uuid>=edit
  const [sysForm, setSysForm] = useState(SYS_EMPTY)
  const [sysSaving, setSysSaving] = useState(false)
  const [sysError, setSysError] = useState('')

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
          if (found) {
            setForm(toForm(found))
            supabase
              .from('home_systems')
              .select('*')
              .eq('home_id', found.id)
              .eq('is_active', true)
              .order('system_type')
              .then(({ data: sys }) => {
                if (!cancelled) setSystems(sys ?? [])
              })
          }
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

  function setSysField(key, value) {
    setSysForm((f) => ({ ...f, [key]: value }))
  }

  function openAddSystem() {
    setSysForm(SYS_EMPTY)
    setSysError('')
    setSysEditId('new')
  }

  function openEditSystem(s) {
    setSysForm({
      system_type: s.system_type ?? '',
      name: s.name ?? '',
      brand: s.brand ?? '',
      model: s.model ?? '',
      install_date: s.install_date ?? '',
      location_in_home: s.location_in_home ?? '',
      notes: s.notes ?? '',
    })
    setSysError('')
    setSysEditId(s.id)
  }

  function closeSystemForm() {
    setSysEditId(null)
    setSysError('')
  }

  async function reloadSystems() {
    const { data } = await supabase
      .from('home_systems')
      .select('*')
      .eq('home_id', home.id)
      .eq('is_active', true)
      .order('system_type')
    setSystems(data ?? [])
  }

  function sysRlsMessage(message) {
    return /row-level security|permission denied/i.test(message)
      ? 'Could not save — the home_systems security policy is not deployed. Run migrations/rls_policies_v2.sql in Supabase.'
      : message
  }

  async function handleSaveSystem(e) {
    e.preventDefault()
    setSysError('')
    setSysSaving(true)

    const payload = {
      system_type: sysForm.system_type,
      name: sysForm.name,
      brand: sysForm.brand || null,
      model: sysForm.model || null,
      install_date: sysForm.install_date || null,
      location_in_home: sysForm.location_in_home || null,
      notes: sysForm.notes || null,
    }

    const { error: saveErr } =
      sysEditId === 'new'
        ? await supabase
            .from('home_systems')
            .insert({ home_id: home.id, ...payload })
        : await supabase
            .from('home_systems')
            .update(payload)
            .eq('id', sysEditId)

    if (saveErr) {
      setSysError(sysRlsMessage(saveErr.message))
      setSysSaving(false)
      return
    }

    setSysSaving(false)
    setSysEditId(null)
    await reloadSystems()
    await regenMaintenance()
  }

  // Best-effort: keep scheduled_maintenance in sync after a system changes.
  // Silent on failure (migration 004 may not be deployed; the Maintenance
  // page also exposes a manual refresh).
  async function regenMaintenance() {
    if (home) await supabase.rpc('generate_maintenance_for_home', { p_home_id: home.id })
  }

  async function handleRemoveSystem(s) {
    if (!window.confirm(`Remove "${s.name}" from your home systems?`)) return
    const { error: rmErr } = await supabase
      .from('home_systems')
      .update({ is_active: false })
      .eq('id', s.id)
    if (rmErr) {
      setSysError(sysRlsMessage(rmErr.message))
      return
    }
    await reloadSystems()
    await regenMaintenance()
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

      <div className="profile-card">
        <div className="card-header">
          <h3>Home Systems</h3>
          {canEdit && sysEditId === null && (
            <button className="btn-secondary" onClick={openAddSystem}>
              Add System
            </button>
          )}
        </div>

        {sysEditId !== null && (
          <form onSubmit={handleSaveSystem} className="system-add-form">
            <h4 className="form-subhead">
              {sysEditId === 'new' ? 'Add a system' : 'Edit system'}
            </h4>
            {sysError && <div className="auth-error">{sysError}</div>}
            <div className="form-row">
              <label className="form-label">
                System type
                <select value={sysForm.system_type} onChange={(e) => setSysField('system_type', e.target.value)} required className="form-input">
                  <option value="">Select…</option>
                  {SYSTEM_TYPES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Name
                <input type="text" value={sysForm.name} onChange={(e) => setSysField('name', e.target.value)} required className="form-input" placeholder="Lennox Furnace" />
              </label>
            </div>
            <div className="form-row form-row-3">
              <label className="form-label">
                Brand (optional)
                <input type="text" value={sysForm.brand} onChange={(e) => setSysField('brand', e.target.value)} className="form-input" />
              </label>
              <label className="form-label">
                Model (optional)
                <input type="text" value={sysForm.model} onChange={(e) => setSysField('model', e.target.value)} className="form-input" />
              </label>
              <label className="form-label">
                Installed (optional)
                <input type="date" value={sysForm.install_date} onChange={(e) => setSysField('install_date', e.target.value)} className="form-input" />
              </label>
            </div>
            <label className="form-label">
              Location in home (optional)
              <input type="text" value={sysForm.location_in_home} onChange={(e) => setSysField('location_in_home', e.target.value)} className="form-input" placeholder="Basement utility closet" />
            </label>
            <label className="form-label">
              Notes (optional)
              <textarea value={sysForm.notes} onChange={(e) => setSysField('notes', e.target.value)} className="form-input" rows={2} />
            </label>
            <button type="submit" className="btn-primary-full" disabled={sysSaving}>
              {sysSaving ? 'Saving…' : sysEditId === 'new' ? 'Add System' : 'Save Changes'}
            </button>
            <button type="button" className="btn-back" onClick={closeSystemForm} disabled={sysSaving}>
              Cancel
            </button>
          </form>
        )}

        {systems.length === 0
          ? sysEditId === null && (
              <p className="page-placeholder">
                No systems added yet. Track your HVAC, water heater, roof, and
                appliances here to get maintenance reminders.
              </p>
            )
          : sysEditId === null && (
              <ul className="systems-list">
                {systems.map((s) => (
                  <li key={s.id} className="system-row">
                    <div className="system-main">
                      <span className="system-name">{s.name}</span>
                      <span className="system-meta">
                        {s.system_type?.replace(/_/g, ' ')}
                        {s.location_in_home ? ` · ${s.location_in_home}` : ''}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="system-actions">
                        <button className="btn-link" onClick={() => openEditSystem(s)}>
                          Edit
                        </button>
                        <button className="btn-link btn-link-danger" onClick={() => handleRemoveSystem(s)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
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
