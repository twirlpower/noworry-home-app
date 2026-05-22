import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { tierLabel } from '../lib/tiers'
import PaymentModal from '../components/PaymentModal'
import DowngradeConfirmModal from '../components/DowngradeConfirmModal'

const MS_PER_DAY = 86400000

// Circle pillar = Full → may rename the circle (same matrix as HomeProfile /
// Circle). Enforced server-side by circles_update (rls_policies_v1.sql).
// care_coordinator is the v1.5 rename of care_partner (migration 014);
// both kept here so existing care_partner rows retain access. RLS update
// to recognize care_coordinator ships in a follow-up migration.
const RENAME_ROLES = ['home_owner', 'circle_manager', 'care_partner', 'care_coordinator']

// Settings edits the email channel only. in_app is implicit; sms/push aren't
// wired to a delivery path yet, so exposing them here would over-promise.
const CHANNEL = 'email'

const TIMEZONES = [
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

const PROFILE_EMPTY = {
  first_name: '',
  last_name: '',
  phone: '',
  date_of_birth: '',
  timezone: 'America/Denver',
}

const PREFS_DEFAULT = {
  task_alerts: true,
  maintenance_alerts: true,
  home_health_alerts: true,
  digest_only: false,
  muted: false,
}

const PREF_FIELDS = [
  ['task_alerts', 'Task alerts', 'When a task is assigned to you or one you follow changes.'],
  ['maintenance_alerts', 'Maintenance reminders', 'Upcoming and overdue home maintenance for this circle.'],
  ['home_health_alerts', 'Home health alerts', 'When the home health score drops or a system needs attention.'],
  ['digest_only', 'Digest only', 'Bundle the above into one summary email instead of sending each one.'],
  ['muted', 'Mute this circle', 'Pause all email for this circle. Other circles are unaffected.'],
]

function profileToForm(p) {
  const f = { ...PROFILE_EMPTY }
  for (const key of Object.keys(PROFILE_EMPTY)) {
    if (p?.[key] !== null && p?.[key] !== undefined) f[key] = p[key]
  }
  return f
}

// Mirror HomeProfile.sysRlsMessage: notification_preferences is deny-all until
// migration 007 is deployed — turn the raw Postgres error into a fixable hint.
function rlsHint(message) {
  return /row-level security|permission denied/i.test(message)
    ? 'Could not save — the notification_preferences policy is not deployed. Run migrations/007_notification_preferences_rls.sql in Supabase.'
    : message
}

export default function Settings() {
  const { person, refreshPerson } = useAuth()
  const { activeCircle, membership, applyCircleUpdate } = useCircle()
  const canRename = RENAME_ROLES.includes(membership?.role)

  // ── My Profile ────────────────────────────────────────────────────────────
  const [pForm, setPForm] = useState(() => profileToForm(person))
  const [pSaving, setPSaving] = useState(false)
  const [pError, setPError] = useState('')
  const [pNotice, setPNotice] = useState('')

  // Seed the editable form when a (different) person first loads. Render-phase
  // adjustment, not an effect — the strict ruleset forbids setState in effects,
  // and this is React's recommended "reset state when a prop changes" pattern.
  // Same id after refreshPerson() = no re-seed, so saved edits aren't clobbered.
  const [pSeededFor, setPSeededFor] = useState(person?.id ?? null)
  if (person && person.id !== pSeededFor) {
    setPSeededFor(person.id)
    setPForm(profileToForm(person))
  }

  function setP(key, value) {
    setPForm((f) => ({ ...f, [key]: value }))
  }

  async function saveProfile(e) {
    e.preventDefault()
    setPError('')
    setPNotice('')
    setPSaving(true)

    const { error } = await supabase
      .from('persons')
      .update({
        first_name: pForm.first_name,
        last_name: pForm.last_name,
        phone: pForm.phone || null,
        date_of_birth: pForm.date_of_birth || null,
        timezone: pForm.timezone || 'America/Denver',
      })
      .eq('id', person.id)

    if (error) {
      setPError(rlsHint(error.message))
      setPSaving(false)
      return
    }

    await refreshPerson()
    setPSaving(false)
    setPNotice('Profile saved.')
  }

  // ── Notification preferences (per active circle, email channel) ────────────
  const [prefs, setPrefs] = useState(PREFS_DEFAULT)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsError, setPrefsError] = useState('')
  const [prefsNotice, setPrefsNotice] = useState('')
  // Loading is derived, not stored: prefs are "loaded" once the resolved
  // circle id matches the active one. Keeps every setState inside the .then()
  // callback (no synchronous setState in the effect body).
  const [prefsLoadedFor, setPrefsLoadedFor] = useState(null)
  const prefsLoading = !!activeCircle && prefsLoadedFor !== activeCircle.id

  useEffect(() => {
    if (!activeCircle || !person) return
    let cancelled = false
    const circleId = activeCircle.id
    supabase
      .from('notification_preferences')
      .select('task_alerts, maintenance_alerts, home_health_alerts, digest_only, muted')
      .eq('person_id', person.id)
      .eq('circle_id', circleId)
      .eq('channel', CHANNEL)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setPrefsError(rlsHint(error.message))
          setPrefs(PREFS_DEFAULT)
        } else {
          setPrefsError('')
          setPrefs(data ? { ...PREFS_DEFAULT, ...data } : PREFS_DEFAULT)
        }
        setPrefsLoadedFor(circleId)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle, person])

  function togglePref(key) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
    setPrefsNotice('')
  }

  async function savePrefs() {
    setPrefsError('')
    setPrefsNotice('')
    setPrefsSaving(true)

    // Upsert on the table's unique (person_id, circle_id, channel) constraint
    // so first-time save inserts and later saves update the same row.
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(
        {
          person_id: person.id,
          circle_id: activeCircle.id,
          channel: CHANNEL,
          ...prefs,
        },
        { onConflict: 'person_id,circle_id,channel' }
      )

    if (error) {
      setPrefsError(rlsHint(error.message))
      setPrefsSaving(false)
      return
    }

    setPrefsSaving(false)
    setPrefsNotice('Notification preferences saved.')
  }

  // ── Billing ───────────────────────────────────────────────────────────────
  const [billingPaymentOpen, setBillingPaymentOpen] = useState(false)
  const [billingCancelOpen, setBillingCancelOpen] = useState(false)
  const [billingDowngradeOpen, setBillingDowngradeOpen] = useState(false)
  const [billingToast, setBillingToast] = useState('')
  // Stable "now" — Date.now() in render is impure per the strict ruleset.
  const [billingNowMs] = useState(() => Date.now())

  // ── Circle ────────────────────────────────────────────────────────────────
  const [renaming, setRenaming] = useState(false)
  const [circleName, setCircleName] = useState('')
  const [cSaving, setCSaving] = useState(false)
  const [cError, setCError] = useState('')

  function startRename() {
    setCircleName(activeCircle?.name ?? '')
    setCError('')
    setRenaming(true)
  }

  async function saveCircleName(e) {
    e.preventDefault()
    setCError('')
    setCSaving(true)

    const { data, error } = await supabase
      .from('family_circles')
      .update({ name: circleName.trim() })
      .eq('id', activeCircle.id)
      .select()
      .single()

    if (error) {
      setCError(rlsHint(error.message))
      setCSaving(false)
      return
    }

    // Reflect the new name in the shared circle cache (nav switcher + this
    // card) without a full reload — immutably, via the context updater.
    applyCircleUpdate(activeCircle.id, { name: data.name })
    setCSaving(false)
    setRenaming(false)
  }

  if (!person) {
    return (
      <div className="page">
        <h1>Settings</h1>
        <p className="page-placeholder">Loading your account…</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {/* My Profile */}
      <form onSubmit={saveProfile} className="profile-card">
        <h3>My Profile</h3>

        {pError && <div className="auth-error" role="alert">{pError}</div>}
        {pNotice && <div className="auth-notice" role="status">{pNotice}</div>}

        <div className="form-row">
          <label className="form-label">
            First name
            <input type="text" value={pForm.first_name} onChange={(e) => setP('first_name', e.target.value)} required className="form-input" />
          </label>
          <label className="form-label">
            Last name
            <input type="text" value={pForm.last_name} onChange={(e) => setP('last_name', e.target.value)} required className="form-input" />
          </label>
        </div>

        <label className="form-label">
          Email
          <input type="email" value={person.email ?? ''} className="form-input" disabled />
        </label>
        <p className="page-placeholder">
          Email is your sign-in identity and can't be changed here.
        </p>

        <div className="form-row">
          <label className="form-label">
            Phone (optional)
            <input type="tel" value={pForm.phone} onChange={(e) => setP('phone', e.target.value)} className="form-input" placeholder="(303) 555-0142" />
          </label>
          <label className="form-label">
            Date of birth (optional)
            <input type="date" value={pForm.date_of_birth} onChange={(e) => setP('date_of_birth', e.target.value)} className="form-input" />
          </label>
        </div>

        <label className="form-label">
          Timezone
          <select value={pForm.timezone} onChange={(e) => setP('timezone', e.target.value)} className="form-input">
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz.replace(/_/g, ' ').replace('America/', '')}</option>
            ))}
          </select>
        </label>

        <button type="submit" className="btn-primary-full" disabled={pSaving}>
          {pSaving ? 'Saving…' : 'Save Profile'}
        </button>
      </form>

      {/* Notifications */}
      <div className="profile-card">
        <h3>Notifications</h3>
        {activeCircle ? (
          <>
            <p className="page-placeholder">
              Email preferences for <strong>{activeCircle.name}</strong>. Each circle is set
              separately.
            </p>

            {prefsError && <div className="auth-error" role="alert">{prefsError}</div>}
            {prefsNotice && <div className="auth-notice" role="status">{prefsNotice}</div>}

            {prefsLoading ? (
              <p className="page-placeholder">Loading preferences…</p>
            ) : (
              <>
                {PREF_FIELDS.map(([key, label, desc]) => (
                  <div key={key} className="profile-section">
                    <label className="form-label form-checkbox">
                      <input
                        type="checkbox"
                        checked={!!prefs[key]}
                        onChange={() => togglePref(key)}
                      />
                      {label}
                    </label>
                    <p className="page-placeholder">{desc}</p>
                  </div>
                ))}

                <button type="button" className="btn-primary-full" onClick={savePrefs} disabled={prefsSaving}>
                  {prefsSaving ? 'Saving…' : 'Save Preferences'}
                </button>
              </>
            )}
          </>
        ) : (
          <p className="page-placeholder">
            Join or create a circle to set notification preferences.
          </p>
        )}
      </div>

      {/* Billing — three states keyed off (subscription_tier, billing_status). */}
      {activeCircle && (() => {
        const tier = activeCircle.subscription_tier
        const billing = activeCircle.billing_status
        const trialEndsAt = activeCircle.trial_ends_at
          ? new Date(activeCircle.trial_ends_at)
          : null
        const periodEndIso = activeCircle.current_period_end
        const onTrial = billing === 'trial' && trialEndsAt
        const daysRemaining = onTrial
          ? Math.max(0, Math.ceil((trialEndsAt.getTime() - billingNowMs) / MS_PER_DAY))
          : null
        const isPaidActive = billing === 'active' && tier === 'prepared'
        const cancelPending = billing === 'canceled' && tier === 'prepared'
        const isAware = tier === 'aware'

        return (
          <div className="profile-card">
            <h3>Billing</h3>

            {billingToast && (
              <div className="auth-notice" role="status">{billingToast}</div>
            )}

            {onTrial && (
              <>
                <p>
                  <strong>Free trial</strong> · {daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setBillingPaymentOpen(true)}
                >
                  Add a payment method to continue →
                </button>
              </>
            )}

            {isPaidActive && (
              <>
                <p><strong>Prepared</strong> · $12/month</p>
                {activeCircle.payment_method_brand && activeCircle.payment_method_last4 && (
                  <p className="page-placeholder">
                    {activeCircle.payment_method_brand} ending in{' '}
                    {activeCircle.payment_method_last4}
                  </p>
                )}
                {periodEndIso && (
                  <p className="page-placeholder">
                    Next billing:{' '}
                    {new Date(periodEndIso).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                )}
                <button
                  type="button"
                  className="btn-link btn-link-danger"
                  onClick={() => setBillingCancelOpen(true)}
                >
                  Cancel subscription
                </button>
              </>
            )}

            {cancelPending && (
              <>
                <p><strong>Prepared</strong> · canceling at period end</p>
                {periodEndIso && (
                  <p className="page-placeholder">
                    Access continues through{' '}
                    {new Date(periodEndIso).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    , then switches to the free Aware plan.
                  </p>
                )}
              </>
            )}

            {isAware && (
              <>
                <p>You're on the free Aware plan.</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setBillingPaymentOpen(true)}
                >
                  Upgrade to Prepared →
                </button>
              </>
            )}
          </div>
        )
      })()}

      {/* Privacy & Security — read-only reassurance card. Mirrors the trust
          bar on the Documents page and the public privacy.html section. */}
      <div className="profile-card">
        <h3>Your Privacy &amp; Document Security</h3>
        <p>
          Documents you upload are encrypted and stored on AWS — the same
          infrastructure trusted by Amazon, Netflix, and the US federal
          government.
        </p>
        <p>
          Only members of your family circle can access your documents.
          NoWorry Home staff cannot view your files.
        </p>
        <p>
          Your documents are backed up automatically. If you need to restore
          an archived document, contact us within 30 days at{' '}
          <a href="mailto:support@noworry-home.com">support@noworry-home.com</a>.
        </p>
        <p>
          Your files are never used for advertising, analytics, or AI
          training — ever.
        </p>
      </div>

      {/* Circle */}
      <div className="profile-card">
        <div className="card-header">
          <h3>Circle</h3>
          {activeCircle && canRename && !renaming && (
            <button className="btn-secondary" onClick={startRename}>
              Rename
            </button>
          )}
        </div>

        {!activeCircle ? (
          <p className="page-placeholder">You don't have a Home Circle yet.</p>
        ) : renaming ? (
          <form onSubmit={saveCircleName}>
            {cError && <div className="auth-error" role="alert">{cError}</div>}
            <label className="form-label">
              Circle name
              <input
                type="text"
                value={circleName}
                onChange={(e) => setCircleName(e.target.value)}
                required
                className="form-input"
              />
            </label>
            <button type="submit" className="btn-primary-full" disabled={cSaving || !circleName.trim()}>
              {cSaving ? 'Saving…' : 'Save Name'}
            </button>
            <button type="button" className="btn-back" onClick={() => setRenaming(false)} disabled={cSaving}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Name</span>
                <span className="detail-value">{activeCircle.name}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Plan</span>
                <span className="detail-value">
                  {tierLabel(activeCircle.subscription_tier)}
                </span>
              </div>
            </div>
            <p className="page-placeholder">
              Manage members and invitations on the{' '}
              <Link to="/circle">My Circle</Link> page.
            </p>
          </>
        )}
      </div>

      <PaymentModal
        open={billingPaymentOpen}
        onClose={() => setBillingPaymentOpen(false)}
        onSuccess={() => setBillingToast('Welcome to Prepared! 🎉 Your subscription is active.')}
      />
      <DowngradeConfirmModal
        open={billingCancelOpen}
        onClose={() => setBillingCancelOpen(false)}
        onConfirmed={() => setBillingToast('Subscription canceled — you keep access until the end of this period.')}
        variant="cancel"
        periodEndIso={activeCircle?.current_period_end}
      />
      <DowngradeConfirmModal
        open={billingDowngradeOpen}
        onClose={() => setBillingDowngradeOpen(false)}
        variant="aware"
      />
    </div>
  )
}
