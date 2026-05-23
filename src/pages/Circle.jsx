import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { ROLE_LABELS } from '../lib/circleRoles'
import { RELATIONSHIP_OPTIONS, GENDER_OPTIONS } from '../utils/homeDisplayName'

// Roles allowed to edit a homeowner's pronouns. Circle managers and the
// home owner themselves can change it; everyone else just reads.
const PRONOUN_EDIT_ROLES = new Set(['home_owner', 'circle_manager'])
import RoleSelect from '../components/RoleSelect'

// Family pillar = Full → can manage members (Family Graph matrix).
// care_coordinator is the v1.5 rename of care_partner (migration 014); both
// kept so existing care_partner rows retain access. RLS update to recognize
// care_coordinator ships in a follow-up migration.
const MANAGE_ROLES = ['home_owner', 'circle_manager', 'care_partner', 'care_coordinator']

export default function Circle() {
  const { person } = useAuth()
  const { activeCircle, membership } = useCircle()
  const canManage = MANAGE_ROLES.includes(membership?.role)

  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showInvite, setShowInvite] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('family_member')
  const [relationship, setRelationship] = useState('')
  // Structured relationship for personalized display names (Phase 2).
  // Kept alongside the freeform `relationship` field — the legacy text
  // continues to drive the inline label ("· daughter") while the enum
  // feeds getHomeDisplayName everywhere else.
  const [relationshipKind, setRelationshipKind] = useState('other')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!activeCircle) return
    let cancelled = false
    supabase
      .from('circle_memberships')
      .select('id, role, status, relationship, person_id, persons!person_id (id, first_name, last_name, email, auth_status, gender)')
      .eq('circle_id', activeCircle.id)
      .order('created_at', { ascending: true })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setMembers(data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle])

  // Update a homeowner's pronouns. Visible only to circle_manager /
  // home_owner viewers (see PRONOUN_EDIT_ROLES). Best-effort — reload
  // members on success so the chip selection reflects immediately.
  async function updateHomeownerGender(personId, newGender) {
    if (!personId) return
    const { error: gErr } = await supabase
      .from('persons')
      .update({ gender: newGender })
      .eq('id', personId)
    if (!gErr) await reloadMembers()
  }

  async function reloadMembers() {
    const { data } = await supabase
      .from('circle_memberships')
      .select('id, role, status, relationship, person_id, persons!person_id (id, first_name, last_name, email, auth_status, gender)')
      .eq('circle_id', activeCircle.id)
      .order('created_at', { ascending: true })
    setMembers(data ?? [])
  }

  function openInvite() {
    setFirst(''); setLast(''); setEmail(''); setRole('family_member')
    setRelationship(''); setRelationshipKind('other')
    setError(''); setNotice(''); setShowInvite(true)
  }

  async function handleInvite(e) {
    e.preventDefault()
    setError(''); setNotice(''); setSaving(true)

    // Create the invited person (no auth yet — they'll claim it on signup).
    const { data: invited, error: pErr } = await supabase
      .from('persons')
      .insert({
        first_name: first,
        last_name: last,
        email: email || null,
        auth_status: 'proxy',
        created_by: person.id,
      })
      .select()
      .single()

    if (pErr) {
      setError(
        /duplicate key|unique/i.test(pErr.message)
          ? 'Someone with that email already has a profile.'
          : pErr.message
      )
      setSaving(false)
      return
    }

    const { error: mErr } = await supabase.from('circle_memberships').insert({
      person_id: invited.id,
      circle_id: activeCircle.id,
      role,
      status: 'invited',
      relationship: relationship || null,
      relationship_kind: relationshipKind,
      invited_by: person.id,
    })

    if (mErr) {
      setError(mErr.message)
      setSaving(false)
      return
    }

    setSaving(false)
    setShowInvite(false)
    setNotice(
      `${first} was added as a pending ${ROLE_LABELS[role]}. Email invitations ` +
      `(account claim) ship in a later phase — for now they appear here as “invited”.`
    )
    await reloadMembers()
  }

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>My Circle</h1>
        <p className="page-placeholder">You don't have a Home Circle yet.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen" role="status">
          <div className="loading-spinner" />
          <p>Loading circle…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Circle</h1>
        {canManage && !showInvite && (
          <button className="btn-secondary" onClick={openInvite}>
            Invite Member
          </button>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}

      {showInvite && (
        <form onSubmit={handleInvite} className="profile-section">
          <h3>Invite a family member</h3>
          <div className="form-row">
            <label className="form-label">
              First name
              <input type="text" value={first} onChange={(e) => setFirst(e.target.value)} required className="form-input" />
            </label>
            <label className="form-label">
              Last name
              <input type="text" value={last} onChange={(e) => setLast(e.target.value)} required className="form-input" />
            </label>
          </div>
          <label className="form-label">
            Email (optional for now)
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="form-input" placeholder="them@example.com" />
          </label>
          <RoleSelect name="invite-role" value={role} onChange={setRole} />

          <p className="form-label" style={{ marginTop: '0.6rem' }}>
            Their relationship to the homeowner
          </p>
          <div className="relationship-picker">
            {RELATIONSHIP_OPTIONS.filter((opt) => opt.value !== 'self').map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`relationship-pick ${relationshipKind === opt.value ? 'on' : ''}`}
                onClick={() => setRelationshipKind(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label className="form-label">
            Relationship label (optional)
            <input type="text" value={relationship} onChange={(e) => setRelationship(e.target.value)} className="form-input" placeholder="daughter, neighbor…" />
          </label>
          <button type="submit" className="btn-primary-full" disabled={saving}>
            {saving ? 'Adding…' : 'Add to Circle'}
          </button>
          <button type="button" className="btn-back" onClick={() => setShowInvite(false)} disabled={saving}>
            Cancel
          </button>
        </form>
      )}

      <div className="profile-card">
        <h3>Members</h3>
        <ul className="member-list">
          {members.map((m) => {
            const canEditPronouns = m.role === 'home_owner' && PRONOUN_EDIT_ROLES.has(membership?.role)
            return (
              <li key={m.id} className="member-row">
                <div className="member-main">
                  <span className="member-name">
                    {m.persons?.first_name} {m.persons?.last_name}
                  </span>
                  <span className="member-meta">
                    {ROLE_LABELS[m.role] ?? m.role}
                    {m.relationship ? ` · ${m.relationship}` : ''}
                  </span>
                  {canEditPronouns && (
                    <div className="member-pronoun-row">
                      <span className="member-pronoun-label">Pronouns:</span>
                      {GENDER_OPTIONS.slice(0, 3).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`member-pronoun-chip ${m.persons?.gender === opt.value ? 'on' : ''}`}
                          onClick={() => updateHomeownerGender(m.person_id, opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className={`member-status status-${m.status}`}>{m.status}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
