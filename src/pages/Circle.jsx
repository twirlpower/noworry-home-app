import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'

// Family pillar = Full → can manage members (Family Graph matrix).
const MANAGE_ROLES = ['home_owner', 'circle_manager', 'care_partner']

const ROLE_LABELS = {
  home_owner: 'Home Owner',
  circle_manager: 'Circle Manager',
  care_partner: 'Care Partner',
  service_partner: 'Service Partner',
  helper: 'Helper',
  family_member: 'Family Member',
  trusted_advisor: 'Trusted Advisor',
}

// Roles an inviter can assign (not Home Owner — that's the proxy/owner set at
// onboarding, not invited).
const INVITABLE = ['family_member', 'care_partner', 'circle_manager', 'helper', 'service_partner', 'trusted_advisor']

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
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!activeCircle) return
    let cancelled = false
    supabase
      .from('circle_memberships')
      .select('id, role, status, relationship, persons!person_id (first_name, last_name, email, auth_status)')
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

  async function reloadMembers() {
    const { data } = await supabase
      .from('circle_memberships')
      .select('id, role, status, relationship, persons!person_id (first_name, last_name, email, auth_status)')
      .eq('circle_id', activeCircle.id)
      .order('created_at', { ascending: true })
    setMembers(data ?? [])
  }

  function openInvite() {
    setFirst(''); setLast(''); setEmail(''); setRole('family_member')
    setRelationship(''); setError(''); setNotice(''); setShowInvite(true)
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
          <div className="form-row">
            <label className="form-label">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)} className="form-input">
                {INVITABLE.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Relationship (optional)
              <input type="text" value={relationship} onChange={(e) => setRelationship(e.target.value)} className="form-input" placeholder="daughter, neighbor…" />
            </label>
          </div>
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
          {members.map((m) => (
            <li key={m.id} className="member-row">
              <div className="member-main">
                <span className="member-name">
                  {m.persons?.first_name} {m.persons?.last_name}
                </span>
                <span className="member-meta">
                  {ROLE_LABELS[m.role] ?? m.role}
                  {m.relationship ? ` · ${m.relationship}` : ''}
                </span>
              </div>
              <span className={`member-status status-${m.status}`}>{m.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
