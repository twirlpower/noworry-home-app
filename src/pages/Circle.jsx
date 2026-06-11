import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { ROLE_LABELS } from '../lib/circleRoles'
import { RELATIONSHIP_OPTIONS, GENDER_OPTIONS } from '../utils/homeDisplayName'

// Roles allowed to edit a homeowner's pronouns. Circle managers and the
// home owner themselves can change it; everyone else just reads.
const PRONOUN_EDIT_ROLES = new Set(['home_owner', 'circle_manager'])

// Roles allowed to manage trusted_advisor grants (migration 040). Same
// set the DB enforces in advisor_grants_admin_select / _write / _update.
const GRANT_ADMIN_ROLES = new Set(['home_owner', 'circle_manager'])
import RoleSelect from '../components/RoleSelect'

// Family pillar = Full → can manage members (Family Graph matrix).
// care_coordinator is the v1.5 rename of care_partner (migration 014); both
// kept so existing care_partner rows retain access. RLS update to recognize
// care_coordinator ships in a follow-up migration.
const MANAGE_ROLES = ['home_owner', 'circle_manager', 'care_partner', 'care_coordinator']

export default function Circle() {
  const { person } = useAuth()
  const { activeCircle, membership, reloadCircles } = useCircle()
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
    if (!PRONOUN_EDIT_ROLES.has(membership?.role)) {
      console.warn('[Circle] pronoun update blocked: role', membership?.role)
      return
    }
    if (!personId) return
    const { error: gErr } = await supabase
      .from('persons')
      .update({ gender: newGender })
      .eq('id', personId)
    if (!gErr) {
      await reloadMembers()
      // Also refresh CircleContext so the AppShell switcher + Dashboard
      // greeting pick up the new pronouns immediately (the homeowners[]
      // array is decorated by loadCircles, not by reloadMembers above).
      reloadCircles?.()
    }
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
    if (!canManage) {
      console.warn('[Circle] invite blocked: role', membership?.role)
      return
    }
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
      .maybeSingle()

    if (pErr) {
      setError(
        /duplicate key|unique/i.test(pErr.message)
          ? 'Someone with that email already has a profile.'
          : pErr.message
      )
      setSaving(false)
      return
    }

    if (!invited) {
      setError('Could not create the member profile — please try again.')
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

      {membership?.role === 'view_only' && (
        <p className="page-placeholder">
          You have view-only access to this home.
        </p>
      )}

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
            const showGrantPanel = m.role === 'trusted_advisor' && GRANT_ADMIN_ROLES.has(membership?.role)
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
                  {showGrantPanel && (
                    <TrustedAdvisorGrants
                      advisor={m}
                      circleId={activeCircle.id}
                      grantedByPersonId={person.id}
                      canManage={GRANT_ADMIN_ROLES.has(membership?.role)}
                    />
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

// Inline grant-management panel rendered for each trusted_advisor member
// when the viewer is a circle admin. Lets the admin toggle access to
// individual documents and emergency contacts; revocation flips
// revoked_at on the existing grant row (we keep history, never delete).
function TrustedAdvisorGrants({ advisor, circleId, grantedByPersonId, canManage }) {
  const [documents, setDocuments] = useState([])
  const [contacts, setContacts] = useState([])
  const [grants, setGrants] = useState({ document: new Set(), emergency_contact: new Set() })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!advisor?.person_id || !circleId) return
    let cancelled = false
    async function load() {
      const [docsRes, ecRes, grantsRes] = await Promise.all([
        supabase.from('documents').select('id, title, document_type, is_archived').eq('circle_id', circleId),
        supabase.from('emergency_contacts').select('id, name, relationship').eq('circle_id', circleId),
        supabase.from('advisor_grants')
          .select('resource_type, resource_id')
          .eq('circle_id', circleId)
          .eq('advisor_person_id', advisor.person_id)
          .is('revoked_at', null),
      ])
      if (cancelled) return
      // Filter archived docs out of the grant chooser — granting access
      // to a soft-deleted doc isn't useful.
      setDocuments((docsRes.data ?? []).filter((d) => !d.is_archived))
      setContacts(ecRes.data ?? [])
      const next = { document: new Set(), emergency_contact: new Set() }
      for (const g of grantsRes.data ?? []) {
        if (next[g.resource_type]) next[g.resource_type].add(g.resource_id)
      }
      setGrants(next)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [advisor?.person_id, circleId])

  async function toggleGrant(resourceType, resourceId, currentlyGranted) {
    if (!canManage) {
      console.warn('[Circle] grant change blocked: insufficient role')
      return
    }
    if (busy) return
    setBusy(true); setErr('')
    if (currentlyGranted) {
      const { error } = await supabase
        .from('advisor_grants')
        .update({ revoked_at: new Date().toISOString() })
        .eq('circle_id', circleId)
        .eq('advisor_person_id', advisor.person_id)
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .is('revoked_at', null)
      if (error) { setErr(error.message); setBusy(false); return }
      setGrants((g) => {
        const next = { ...g, [resourceType]: new Set(g[resourceType]) }
        next[resourceType].delete(resourceId)
        return next
      })
    } else {
      const { error } = await supabase.from('advisor_grants').insert({
        circle_id:           circleId,
        advisor_person_id:   advisor.person_id,
        resource_type:       resourceType,
        resource_id:         resourceId,
        granted_by:          grantedByPersonId,
      })
      if (error) {
        // 23505 = unique constraint violation — likely a previously-
        // revoked grant. Re-open it by clearing revoked_at instead.
        if (error.code === '23505') {
          const { error: upErr } = await supabase
            .from('advisor_grants')
            .update({ revoked_at: null, granted_at: new Date().toISOString(), granted_by: grantedByPersonId })
            .eq('circle_id', circleId)
            .eq('advisor_person_id', advisor.person_id)
            .eq('resource_type', resourceType)
            .eq('resource_id', resourceId)
          if (upErr) { setErr(upErr.message); setBusy(false); return }
        } else {
          setErr(error.message); setBusy(false); return
        }
      }
      setGrants((g) => {
        const next = { ...g, [resourceType]: new Set(g[resourceType]) }
        next[resourceType].add(resourceId)
        return next
      })
    }
    setBusy(false)
  }

  if (loading) return <p className="page-placeholder">Loading grants…</p>

  return (
    <div className="advisor-grants-panel">
      <p className="advisor-grants-title">Trusted Advisor — granted access only</p>
      <p className="advisor-grants-help">
        This person sees nothing by default. Check items below to grant
        access. Grants are logged and can be revoked at any time.
      </p>

      {err && <div className="auth-error" role="alert">{err}</div>}

      {documents.length > 0 && (
        <div className="advisor-grants-section">
          <p className="advisor-grants-section-h">Documents</p>
          {documents.map((doc) => {
            const granted = grants.document.has(doc.id)
            return (
              <label key={doc.id} className="advisor-grants-row">
                <input
                  type="checkbox"
                  checked={granted}
                  disabled={busy}
                  onChange={() => toggleGrant('document', doc.id, granted)}
                />
                <span>{doc.title || doc.document_type || '(untitled)'}</span>
              </label>
            )
          })}
        </div>
      )}

      {contacts.length > 0 && (
        <div className="advisor-grants-section">
          <p className="advisor-grants-section-h">Emergency Contacts</p>
          {contacts.map((c) => {
            const granted = grants.emergency_contact.has(c.id)
            return (
              <label key={c.id} className="advisor-grants-row">
                <input
                  type="checkbox"
                  checked={granted}
                  disabled={busy}
                  onChange={() => toggleGrant('emergency_contact', c.id, granted)}
                />
                <span>{c.name || '(unnamed)'}{c.relationship ? ` — ${c.relationship}` : ''}</span>
              </label>
            )
          })}
        </div>
      )}

      {documents.length === 0 && contacts.length === 0 && (
        <p className="page-placeholder">
          Add documents or emergency contacts to this circle first, then
          you can grant access here.
        </p>
      )}
    </div>
  )
}

