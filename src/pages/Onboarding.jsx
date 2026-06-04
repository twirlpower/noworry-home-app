import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { normalizeAddress } from '../lib/normalizeAddress'
import { RELATIONSHIP_OPTIONS } from '../utils/homeDisplayName'
import { track } from '../lib/analytics'

// Phase 3c — relationship_kinds where the homeowner is being set up by
// someone else who knows the homeowner prefers minimal complexity. The
// default homeowner_view_preference flips to 'simple' for these; the
// adult-child author can still override per the preference picker.
// Spouse + professional + other land on 'standard' (the column default)
// because the homeowner is more likely to want the full picture.
const SIMPLE_RELATIONSHIPS = ['adult_child', 'grandchild', 'sibling']

export default function Onboarding() {
  const location = useLocation()
  const navigate = useNavigate()
  const { person } = useAuth()
  const { reloadCircles } = useCircle()
  const setupType = location.state?.setupType || 'self'

  const [step, setStep] = useState(setupType === 'other' ? 'homeowner' : 'home')
  const [loading, setLoading] = useState(false)
  // Captured at mount so time_to_complete_seconds reflects the actual
  // session, not the time since the last re-render.
  const onboardingStartedAt = useRef(Date.now())
  const [error, setError] = useState('')
  const [createdCircleId, setCreatedCircleId] = useState(null)
  // Set when check_home_address_taken finds an active circle at the
  // typed address — replaces the Next/Submit button with a warm
  // contact-support message. Cleared by editing the address.
  const [addressConflict, setAddressConflict] = useState(null)
  // Lightweight invite-family step (v1.5 activation track). Single email +
  // role, success state revealed after send. `inviteSent` flips on success
  // to show the confirmation screen.
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('family_member')
  const [inviteSent, setInviteSent] = useState(false)

  // Home Owner info (for "setting up for someone else")
  const [ownerFirst, setOwnerFirst] = useState('')
  const [ownerLast, setOwnerLast] = useState('')
  // Path B picker — structured relationship that drives the personalized
  // home-display name. 'adult_child' is the most common case; the user
  // confirms their choice on the picker. Replaces the prior freeform
  // ownerRelationship dropdown (which got passed into p_owner_relationship
  // — we now send null there since the picker value lives on
  // circle_memberships.relationship_kind instead).
  const [relationshipKind, setRelationshipKind] = useState('adult_child')

  // Phase 3c — Path B authoring of the homeowner's first experience.
  //   homeownerViewPreference: 'standard' | 'simple' | null
  //     null = "use the relationship default" (adult_child / grandchild /
  //     sibling → simple, everyone else → standard). Explicit picks
  //     override the relationship default.
  //   welcomeMessage: optional note the homeowner sees the first time
  //     they open the app. Capped at 500 chars by both the textarea
  //     and the table's CHECK constraint.
  const [homeownerViewPreference, setHomeownerViewPreference] = useState(null)
  const [welcomeMessage, setWelcomeMessage] = useState('')

  // Home profile
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('CO')
  const [zip, setZip] = useState('')
  const [yearBuilt, setYearBuilt] = useState('')
  const [sqft, setSqft] = useState('')
  const [bedrooms, setBedrooms] = useState('')
  const [bathrooms, setBathrooms] = useState('')

  // Home classification (Part A — drives property_tier).
  // Stories field uses string values for the radio form; we coerce
  // to integer when saving. dryer_vent_exit is one of:
  //   'ground_wall' | 'second_floor_wall' | 'roof' | 'unknown'
  const [storiesAns, setStoriesAns] = useState('')
  const [hvacAns, setHvacAns] = useState('')
  const [ventAns, setVentAns] = useState('')

  // Computed property tier from the three answers. Enhanced if 2+ HVAC
  // systems OR the dryer vent exits through the roof. Never displayed
  // to the member by name; only used to drive pricing copy.
  const propertyTier = (
    (Number(hvacAns) >= 2) || ventAns === 'roof'
  ) ? 'enhanced' : 'standard'

  // Address autocomplete from home_seeds (Arapahoe/Douglas assessor data).
  const [suggestions, setSuggestions] = useState([])
  const [selectedSeed, setSelectedSeed] = useState(null)

  useEffect(() => {
    if (selectedSeed) return // a match is chosen — don't re-search
    const t = setTimeout(async () => {
      const q = address.trim()
      if (q.length < 3) {
        setSuggestions([])
        return
      }
      // Prefix tsquery so it uses the GIN full-text index on address_line1.
      const terms = q
        .split(/\s+/)
        .map((s) => s.replace(/[^\w]/g, ''))
        .filter(Boolean)
      if (!terms.length) return
      terms[terms.length - 1] += ':*'
      const { data } = await supabase
        .from('home_seeds')
        .select(
          'id,address_line1,city,state,zip,year_built,square_feet,bedrooms,bathrooms,stories,hvac_type,roof_type'
        )
        .textSearch('address_line1', terms.join(' & '))
        .limit(8)
      setSuggestions(data ?? [])
    }, 250)
    return () => clearTimeout(t)
  }, [address, selectedSeed])

  function onAddressChange(v) {
    setSelectedSeed(null) // manual typing clears any chosen match
    setAddress(v)
    if (addressConflict) setAddressConflict(null)
  }

  function selectSeed(s) {
    setAddress(s.address_line1)
    setCity(s.city || '')
    setState(s.state || 'CO')
    setZip(s.zip || '')
    setYearBuilt(s.year_built ?? '')
    setSqft(s.square_feet ?? '')
    setBedrooms(s.bedrooms ?? '')
    setBathrooms(s.bathrooms ?? '')
    setSuggestions([])
    setSelectedSeed(s)
  }

  async function handleComplete(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!person) {
      setError(
        'Your account is signed in but your profile record is missing. ' +
        'This usually means the database setup is incomplete — sign out, ' +
        'create a fresh account, and try again.'
      )
      setLoading(false)
      return
    }

    // Address uniqueness: refuse to create another circle on top of an
    // existing active home. check_home_address_taken is SECURITY DEFINER
    // so this works even though the user can't see homes via member RLS.
    const normalized = normalizeAddress(address)
    if (normalized && zip) {
      const { data: takenRows, error: takenErr } = await supabase.rpc(
        'check_home_address_taken',
        { p_normalized_address: normalized, p_zip: zip }
      )
      if (takenErr) {
        setError(takenErr.message)
        setLoading(false)
        return
      }
      const taken = takenRows?.[0]
      if (taken?.home_id) {
        setAddressConflict({ homeId: taken.home_id, address, city, state, zip })
        setLoading(false)
        // Best-effort admin notification (failure does not affect UX).
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const token = session?.access_token
          if (token) {
            fetch('/api/admin/notify-address-conflict', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                address: { line1: address, city, state, zip },
                existingHomeId: taken.home_id,
              }),
            }).catch(() => {})
          }
        } catch {
          /* ignore */
        }
        return
      }
    }

    const circleName = setupType === 'other'
      ? `${ownerFirst}'s Home Circle`
      : `${person.first_name}'s Home Circle`

    // Single atomic RPC — creates home, circle, link, and memberships in one
    // transaction (SECURITY DEFINER, so it isn't blocked by the RLS bootstrap
    // chicken-and-egg). See migrations/rls_policies_v1.sql.
    const { data: circleId, error: rpcError } = await supabase.rpc('setup_home_circle', {
      p_setup_type: setupType,
      p_circle_name: circleName,
      p_home: {
        address_line1: address,
        address_line2: '',
        city,
        state,
        zip,
        year_built: yearBuilt,
        square_feet: sqft,
        bedrooms,
        bathrooms,
      },
      p_owner_first: setupType === 'other' ? ownerFirst : null,
      p_owner_last: setupType === 'other' ? ownerLast : null,
      p_owner_relationship: null,
    })

    if (rpcError) {
      setError(rpcError.message || 'Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    // Stamp the structured relationship_kind on the acting user's
    // membership in the new circle. Migration 038's backfill sets
    // 'self' for home_owner / circle_manager rows on EXISTING circles;
    // new rows from setup_home_circle won't have it until we set it
    // here. Path A users are self, Path B users picked their relation
    // to the homeowner on the prior step.
    if (circleId) {
      const kind = setupType === 'other' ? relationshipKind : 'self'
      try {
        await supabase
          .from('circle_memberships')
          .update({ relationship_kind: kind })
          .eq('circle_id', circleId)
          .eq('person_id', person.id)
          .eq('status', 'active')
      } catch {
        /* best-effort — non-fatal */
      }
    }

    // Phase 3c — Path B: author the homeowner's first experience.
    //   1. Resolve the homeowner's person_id (setup_home_circle made a
    //      proxy persons row for them; we look it up by walking the
    //      circle's home_owner membership).
    //   2. Compute the effective view preference and update the
    //      homeowner's row when it differs from the column default
    //      ('standard'). Path A is always self → no write needed; the
    //      DB default keeps them on Standard.
    //   3. Insert the welcome message if the author wrote one.
    // Both writes are best-effort: failure here doesn't undo the
    // already-created circle.
    if (circleId && setupType === 'other') {
      try {
        const { data: ownerRow } = await supabase
          .from('circle_memberships')
          .select('person_id')
          .eq('circle_id', circleId)
          .eq('role', 'home_owner')
          .eq('status', 'active')
          .maybeSingle()
        const homeownerPersonId = ownerRow?.person_id
        if (homeownerPersonId) {
          // Effective preference: explicit pick wins; otherwise the
          // SIMPLE_RELATIONSHIPS default applies; otherwise standard.
          let effectivePref = 'standard'
          if (homeownerViewPreference === 'simple' || homeownerViewPreference === 'standard') {
            effectivePref = homeownerViewPreference
          } else if (SIMPLE_RELATIONSHIPS.includes(relationshipKind)) {
            effectivePref = 'simple'
          }
          if (effectivePref === 'simple') {
            await supabase
              .from('persons')
              .update({ homeowner_view_preference: 'simple' })
              .eq('id', homeownerPersonId)
          }
          const trimmedNote = welcomeMessage.trim()
          if (trimmedNote) {
            await supabase
              .from('circle_welcome_messages')
              .insert({
                circle_id: circleId,
                from_person_id: person.id,
                to_person_id: homeownerPersonId,
                message: trimmedNote.slice(0, 500),
              })
          }
        }
      } catch {
        /* best-effort — non-fatal */
      }
    }

    // Best-effort: persist seed extras + the classification answers from
    // the new home-tier step. The bootstrap RPC's p_home contract doesn't
    // take these fields, so we patch them in via a follow-up update on
    // homes. Non-fatal — onboarding already succeeded if we got here.
    if (circleId) {
      try {
        const { data: ch } = await supabase
          .from('circle_homes')
          .select('home_id')
          .eq('circle_id', circleId)
          .eq('status', 'active')
          .limit(1)
        const homeId = ch?.[0]?.home_id
        if (homeId) {
          // Build the classification patch, overlaying onto seed extras
          // when present. Tier-input answers always win over the seed
          // since the user explicitly chose them.
          const patch = {}
          if (storiesAns)            patch.stories             = Number(storiesAns)
          else if (selectedSeed?.stories) patch.stories         = selectedSeed.stories
          if (hvacAns)               patch.hvac_system_count   = Number(hvacAns)
          if (ventAns)               patch.dryer_vent_exit     = ventAns
          if (storiesAns && hvacAns && ventAns) patch.property_tier = propertyTier

          if (Object.keys(patch).length) {
            await supabase.from('homes').update(patch).eq('id', homeId)
          }

          if (selectedSeed) {
            const sys = []
            if (selectedSeed.hvac_type)
              sys.push({ home_id: homeId, system_type: 'hvac', name: selectedSeed.hvac_type })
            if (selectedSeed.roof_type)
              sys.push({ home_id: homeId, system_type: 'roof', name: selectedSeed.roof_type })
            if (sys.length) await supabase.from('home_systems').insert(sys)
          }
        }
      } catch {
        /* extras are convenience only — ignore */
      }
    }

    setCreatedCircleId(circleId)
    setLoading(false)

    // Auto-skip the invite step if the user has already gone through it
    // (per-browser flag). family_circles has no onboarding_completed_at
    // column, so localStorage is the spec-blessed fallback.
    if (typeof window !== 'undefined' &&
        window.localStorage.getItem('onboardingFamilyStepDone') === 'true') {
      await finishOnboarding()
      return
    }

    setStep('invite')
  }

  async function finishOnboarding() {
    // Effective homeowner view (same logic as the post-circle write
    // above) reported for Phase 3c analytics — lets us see which
    // relationship_kinds actually land where.
    let effectivePref = 'standard'
    if (setupType === 'other') {
      if (homeownerViewPreference === 'simple' || homeownerViewPreference === 'standard') {
        effectivePref = homeownerViewPreference
      } else if (SIMPLE_RELATIONSHIPS.includes(relationshipKind)) {
        effectivePref = 'simple'
      }
    }
    track('onboarding_completed', {
      path_taken: setupType === 'self' ? 'A' : 'B',
      relationship_kind: setupType === 'other' ? relationshipKind : 'self',
      homeowner_view_default: effectivePref,
      welcome_message_set: setupType === 'other' && welcomeMessage.trim().length > 0,
      time_to_complete_seconds: Math.round((Date.now() - onboardingStartedAt.current) / 1000),
    })
    await reloadCircles()
    navigate('/dashboard')
  }

  // Both paths out of the invite step (skip OR send-then-dashboard) set the
  // same flag so the step doesn't reappear if onboarding is ever re-entered.
  function markInviteStepDone() {
    try {
      window.localStorage.setItem('onboardingFamilyStepDone', 'true')
    } catch { /* ignore — Safari private mode etc. The flag is a UX nicety, not security. */ }
  }

  function skipInviteStep() {
    markInviteStepDone()
    finishOnboarding()
  }

  // Migration 014 added care_coordinator and view_only to the circle_role
  // enum, so the UI keys now map 1:1 to the DB values — the workaround
  // mapping that used to translate care_coordinator → care_partner and
  // view_only → trusted_advisor is no longer needed.
  async function sendSingleInvite() {
    setError('')
    setLoading(true)

    // persons.first_name / last_name are NOT NULL. Email-only invite — use
    // the email's local-part (capitalized) as the first_name placeholder so
    // the roster reads OK until the invitee signs up and replaces both.
    const email = inviteEmail.trim()
    const local = (email.split('@')[0] || 'invited').replace(/[._-]+/g, ' ')
    const placeholderFirst =
      local.charAt(0).toUpperCase() + local.slice(1)

    const { data: invP, error: pErr } = await supabase
      .from('persons')
      .insert({
        first_name: placeholderFirst,
        last_name: '(pending)',
        email,
        auth_status: 'proxy',
        created_by: person.id,
      })
      .select()
      .single()

    if (pErr) {
      setError(
        /duplicate key|unique/i.test(pErr.message)
          ? 'That email already has a profile — finish onboarding and invite from My Circle instead.'
          : pErr.message
      )
      setLoading(false)
      return
    }

    const { error: mErr } = await supabase.from('circle_memberships').insert({
      person_id: invP.id,
      circle_id: createdCircleId,
      role: inviteRole,
      status: 'invited',
      invited_by: person.id,
    })

    if (mErr) {
      setError(mErr.message)
      setLoading(false)
      return
    }

    setLoading(false)
    setInviteSent(true)
  }

  // Step: invite family (after the circle is created, before the dashboard).
  // Single-invite, skippable, shown once per browser. v1.5 activation track.
  if (step === 'invite') {
    if (inviteSent) {
      return (
        <div className="auth-page">
          <div className="auth-card">
            <div style={{ fontSize: '2.6rem', textAlign: 'center', marginBottom: '0.4rem' }} aria-hidden="true">✓</div>
            <h1>Invite sent to {inviteEmail}</h1>
            <p className="auth-subtitle">
              They&apos;ll show up as <em>invited</em> in your circle. You can manage everyone
              from My Circle anytime. (Account-claim emails ship in a later
              phase — for now the invite is recorded; you can let them know.)
            </p>
            <button
              type="button"
              className="btn-primary-full"
              onClick={() => { markInviteStepDone(); finishOnboarding() }}
            >
              Go to my dashboard →
            </button>
          </div>
        </div>
      )
    }

    // v1.5 spec: 3 role choices with friendly copy. DB enum hasn't been
    // renamed yet — the ROLE_DB_VALUE map (above) translates these keys to
    // care_partner / family_member / trusted_advisor for the INSERT.
    const ROLE_OPTIONS = [
      { key: 'care_coordinator', label: 'Care Coordinator', desc: 'Helps manage the home and coordinate care.' },
      { key: 'family_member',    label: 'Family Member',    desc: 'Stays informed and can help with tasks.' },
      { key: 'view_only',        label: 'View Only',        desc: "Can see everything, can't make changes." },
    ]

    return (
      <div className="auth-page">
        <div className="auth-card">
          <div style={{ fontSize: '2.6rem', textAlign: 'center', marginBottom: '0.4rem' }} aria-hidden="true">👥</div>
          <h1>Bring your family in</h1>
          <p className="auth-subtitle">
            Invite a family member so they can see your home and help when it
            matters. You control exactly what they can see.
          </p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <form onSubmit={(e) => { e.preventDefault(); sendSingleInvite() }}>
            <label className="form-label">
              Email
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="form-input"
                placeholder="them@example.com"
                autoComplete="email"
              />
            </label>

            <fieldset className="role-select">
              <legend className="role-select-legend">Role</legend>
              {ROLE_OPTIONS.map((r) => (
                <label
                  key={r.key}
                  className={`role-option ${inviteRole === r.key ? 'role-option-active' : ''}`}
                >
                  <input
                    type="radio"
                    name="onboarding-invite-role"
                    value={r.key}
                    checked={inviteRole === r.key}
                    onChange={() => setInviteRole(r.key)}
                  />
                  <span className="role-option-text">
                    <span className="role-option-label">{r.label}</span>
                    <span className="role-option-desc">{r.desc}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <button
              type="submit"
              className="btn-primary-full"
              disabled={loading || !inviteEmail.trim()}
            >
              {loading ? 'Sending…' : 'Send Invite'}
            </button>
            <button
              type="button"
              className="btn-back"
              onClick={skipInviteStep}
              disabled={loading}
            >
              Skip for now — I&apos;ll do this later
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Step: Home Owner info (only for "setting up for someone else")
  if (step === 'homeowner') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Who are you setting this up for?</h1>
          <p className="auth-subtitle">
            Tell us about the person whose home you're helping manage.
            They don't need to create an account.
          </p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <div className="form-row">
            <label className="form-label">
              Their first name
              <input type="text" value={ownerFirst} onChange={(e) => setOwnerFirst(e.target.value)} required className="form-input" />
            </label>
            <label className="form-label">
              Their last name
              <input type="text" value={ownerLast} onChange={(e) => setOwnerLast(e.target.value)} required className="form-input" />
            </label>
          </div>

          <p className="form-label" style={{ marginTop: '1rem' }}>
            What's your relationship to {ownerFirst || 'them'}?
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

          <button
            className="btn-primary-full"
            onClick={() => setStep('preferences')}
            disabled={!ownerFirst || !ownerLast || !relationshipKind}
          >
            Continue →
          </button>
        </div>
      </div>
    )
  }

  // Step: Path B authoring — view default + welcome note. Only on
  // setupType='other'; Path A flows straight from setup to 'home'.
  // The view picker shows only for the relationships where the
  // SIMPLE default actually flips (adult_child / grandchild /
  // sibling); for spouse / professional / other we skip it because
  // 'standard' is the default and there's nothing to override yet.
  // The welcome message renders for every Path B path — anyone
  // setting up for someone else can leave them a note.
  if (step === 'preferences') {
    const showViewPicker = SIMPLE_RELATIONSHIPS.includes(relationshipKind)
    const firstName = ownerFirst.trim() || 'them'
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>A few things to set up for {firstName}</h1>
          <p className="auth-subtitle">
            You can change any of this later, and so can {firstName}.
          </p>

          {showViewPicker && (
            <div className="onboarding-section">
              <h2 className="onboarding-section-h2">
                How would {firstName} like to see their home?
              </h2>
              <div className="view-preference-picker">
                <button
                  type="button"
                  className={`view-preference-option ${homeownerViewPreference === 'standard' ? 'on' : ''}`}
                  onClick={() => setHomeownerViewPreference('standard')}
                  aria-pressed={homeownerViewPreference === 'standard'}
                >
                  <span className="view-preference-title">The full picture</span>
                  <span className="view-preference-desc">
                    Maintenance calendar, safety checklist, family updates — everything
                  </span>
                </button>
                <button
                  type="button"
                  className={`view-preference-option ${homeownerViewPreference === 'simple' || (homeownerViewPreference === null) ? 'on' : ''}`}
                  onClick={() => setHomeownerViewPreference('simple')}
                  aria-pressed={homeownerViewPreference === 'simple' || homeownerViewPreference === null}
                >
                  <span className="view-preference-title">Keep it simple</span>
                  <span className="view-preference-desc">
                    Just the health score and what&apos;s coming up — easy to glance at
                  </span>
                </button>
              </div>
              <p className="onboarding-helper">
                We default to <strong>simple</strong> when you&apos;re setting up for a parent or
                relative — most people prefer it. Pick <strong>full picture</strong> if {firstName} likes detail.
              </p>
            </div>
          )}

          <div className="onboarding-section">
            <h2 className="onboarding-section-h2">
              Write a note for {firstName}{' '}
              <span className="onboarding-optional">(optional)</span>
            </h2>
            <p className="onboarding-helper">
              They&apos;ll see this the first time they open the app.
            </p>
            <textarea
              className="welcome-message-textarea"
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value.slice(0, 500))}
              placeholder={`Hi ${firstName}, I set this up so you don't have to worry about the house. Everything is being taken care of.`}
              maxLength={500}
              rows={5}
            />
            <p className="welcome-message-counter">
              {welcomeMessage.length}/500
            </p>
          </div>

          <button
            type="button"
            className="btn-primary-full"
            onClick={() => setStep('home')}
          >
            Continue to Home Profile →
          </button>
          <button className="btn-back" onClick={() => setStep('homeowner')}>
            ← Back
          </button>
        </div>
      </div>
    )
  }

  // Step: Home classification (Part A). Three questions that drive
  // property_tier. Each radio sets a string answer; the Continue button
  // is gated on all three being filled. Standard → handleComplete;
  // enhanced → setStep('enhanced-info') to show the rate explanation
  // first.
  if (step === 'classification') {
    const allAnswered = storiesAns && hvacAns && ventAns
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Tell us about your home</h1>
          <p className="auth-subtitle">This helps us make sure your plan covers everything correctly.</p>

          <fieldset className="classify-group">
            <legend>How many floors does your home have?</legend>
            {[
              ['1', '1 story'],
              ['2', '2 stories'],
              ['3', '3 or more stories'],
            ].map(([v, l]) => (
              <label key={v} className={`classify-radio ${storiesAns === v ? 'on' : ''}`}>
                <input type="radio" name="stories" value={v}
                  checked={storiesAns === v}
                  onChange={() => setStoriesAns(v)} />
                <span>{l}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="classify-group">
            <legend>How many heating and cooling systems does your home have?</legend>
            <p className="classify-help">(A furnace + AC unit = 1 system)</p>
            {[
              ['1', '1 system'],
              ['2', '2 systems (e.g. upstairs + downstairs)'],
              ['3', '3 or more systems'],
            ].map(([v, l]) => (
              <label key={v} className={`classify-radio ${hvacAns === v ? 'on' : ''}`}>
                <input type="radio" name="hvac" value={v}
                  checked={hvacAns === v}
                  onChange={() => setHvacAns(v)} />
                <span>{l}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="classify-group">
            <legend>Where does your dryer vent exit the house?</legend>
            {[
              ['ground_wall',       'Through a ground floor or basement wall (most common)'],
              ['second_floor_wall', 'Through a second floor wall'],
              ['roof',              'Through the roof'],
              ['unknown',           "I'm not sure"],
            ].map(([v, l]) => (
              <label key={v} className={`classify-radio ${ventAns === v ? 'on' : ''}`}>
                <input type="radio" name="vent" value={v}
                  checked={ventAns === v}
                  onChange={() => setVentAns(v)} />
                <span>{l}</span>
              </label>
            ))}
          </fieldset>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <button
            type="button"
            className="btn-primary-full"
            disabled={!allAnswered || loading}
            onClick={(e) => {
              if (!allAnswered) return
              // If enhanced, surface the explanation first; otherwise
              // jump straight to circle creation.
              if (propertyTier === 'enhanced') {
                setStep('enhanced-info')
              } else {
                handleComplete(e)
              }
            }}
          >
            {loading ? 'Setting up your Home Circle...' : 'Continue →'}
          </button>

          <button className="btn-back" onClick={() => setStep('home')}>
            ← Back
          </button>
        </div>
      </div>
    )
  }

  // Step: Enhanced rate explanation. Only reached when the answers
  // resolved to property_tier='enhanced'. Reason text is derived
  // from which condition tripped enhanced (HVAC count vs vent on
  // roof) — multiple conditions are OK, we surface the most relevant.
  if (step === 'enhanced-info') {
    const reason = Number(hvacAns) >= 2
      ? `Your home has ${hvacAns === '3' ? '3 or more' : hvacAns} HVAC systems`
      : 'Your dryer vent exits through the roof'
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Your home qualifies for our Enhanced rate</h1>
          <div className="enhanced-rate-card">
            <p>
              {reason} — so we make sure your plan covers it completely.
            </p>
            <p>Your price is based on your home. We&apos;ll confirm the exact amount with you before anything is charged.</p>
            <p className="auth-subtitle">
              Everything else about your membership is identical — same visits,
              same services, same guarantee.
            </p>
          </div>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <button
            type="button"
            className="btn-primary-full"
            disabled={loading}
            onClick={handleComplete}
          >
            {loading ? 'Setting up your Home Circle...' : 'Continue →'}
          </button>

          <button className="btn-back" onClick={() => setStep('classification')}>
            ← Back
          </button>
        </div>
      </div>
    )
  }

  // Step: Home profile
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>
          {setupType === 'other'
            ? `Tell us about ${ownerFirst}'s home`
            : 'Tell us about your home'}
        </h1>
        <p className="auth-subtitle">
          {selectedSeed
            ? 'We found your home — does this look right? Edit anything that’s off.'
            : 'Start typing your address — we may already have your home on file.'}
        </p>

        {error && <div className="auth-error" role="alert">{error}</div>}
        {selectedSeed && (
          <div className="auth-notice" role="status">
            ✓ Matched from county records. Pre-filled below — please confirm.
          </div>
        )}

        <form onSubmit={(e) => {
          e.preventDefault()
          // Address-uniqueness probe runs in handleComplete; we replicate
          // here so we don't advance into classification with a known
          // conflict still on screen. handleComplete also runs the check
          // a second time as a belt-and-suspenders defense.
          if (addressConflict) return
          setStep('classification')
        }}>
          <label className="form-label">
            Street address
            <div className="seed-combo">
              <input
                type="text"
                value={address}
                onChange={(e) => onAddressChange(e.target.value)}
                required
                className="form-input"
                placeholder="123 Main St"
                autoComplete="off"
              />
              {suggestions.length > 0 && (
                <ul className="seed-suggest">
                  {suggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="seed-option"
                        onClick={() => selectSeed(s)}
                      >
                        <span className="seed-addr">{s.address_line1}</span>
                        <span className="seed-meta">{s.city}, {s.state} {s.zip}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </label>

          <div className="form-row form-row-3">
            <label className="form-label">
              City
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} required className="form-input" />
            </label>
            <label className="form-label">
              State
              <input type="text" value={state} onChange={(e) => setState(e.target.value)} required className="form-input" maxLength={2} />
            </label>
            <label className="form-label">
              Zip
              <input type="text" value={zip} onChange={(e) => setZip(e.target.value)} required className="form-input" maxLength={5} placeholder="80012" />
            </label>
          </div>

          <div className="form-row">
            <label className="form-label">
              Year built (optional)
              <input type="number" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} className="form-input" placeholder="1985" />
            </label>
            <label className="form-label">
              Square feet (optional)
              <input type="number" value={sqft} onChange={(e) => setSqft(e.target.value)} className="form-input" placeholder="2200" />
            </label>
          </div>

          <div className="form-row">
            <label className="form-label">
              Bedrooms (optional)
              <input type="number" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="form-input" />
            </label>
            <label className="form-label">
              Bathrooms (optional)
              <input type="number" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className="form-input" step="0.5" />
            </label>
          </div>

          {addressConflict ? (
            <div className="address-conflict" role="alert">
              <p>This address is already in our system.</p>
              <p>
                If you recently purchased this home or think this is a
                mistake, please contact us and we'll get it sorted out
                quickly.
              </p>
              <a
                className="btn-primary-full"
                href={`mailto:support@noworry-home.com?subject=${encodeURIComponent('Address already registered')}&body=${encodeURIComponent(`Address: ${address}, ${city}, ${state} ${zip}`)}`}
                style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}
              >
                Contact Support →
              </a>
            </div>
          ) : (
            <button type="submit" className="btn-primary-full" disabled={loading}>
              {loading ? 'Setting up your Home Circle...' : 'Continue →'}
            </button>
          )}
        </form>

        {setupType === 'other' && (
          <button className="btn-back" onClick={() => setStep('preferences')}>
            ← Back
          </button>
        )}
      </div>
    </div>
  )
}
