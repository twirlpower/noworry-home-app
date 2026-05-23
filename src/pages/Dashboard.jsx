import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { computeHomeHealth } from '../lib/homeHealth'
import { SAFETY_ITEMS } from '../lib/safetyItems'
import { CRITICAL_TYPE_KEYS } from '../lib/documents'
import { evaluate as evaluatePrompt } from '../lib/promptEngine'
import HealthScore from '../components/HealthScore'
import PreparedReveal from '../components/PreparedReveal'
import PromptCard from '../components/PromptCard'
import PaymentModal from '../components/PaymentModal'
import DowngradeConfirmModal from '../components/DowngradeConfirmModal'

const MS_PER_DAY = 86400000
const TRIAL_TOTAL_DAYS = 30
const TRIAL_WARN_DAYS = 7
// Day-60 partner banner triggers when a 90-day partner trial has 30 or
// fewer days left — keeps members ahead of the day-89 reminder cron.
const PARTNER_BANNER_DAYS_REMAINING = 30

// Monthly charge amounts by tier × cycle. Used to render
// "your card will be charged $X on [date]" in the trial bar. Annual
// amounts come straight from the matrix; monthly is the per-month
// price. Property tier (standard vs enhanced) isn't on family_circles
// yet, so for v1 we display the standard amount — enhanced members
// see their precise number in Settings billing.
const TRIAL_CHARGE_AMOUNTS = {
  prepared: { monthly: 12 },
  covered:  { monthly: 99,  annual: 1068 },
  complete: { monthly: 179, annual: 2148 },
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return ''
  return n >= 1000
    ? `$${n.toLocaleString()}`
    : `$${n}`
}

function fmtTrialDate(d) {
  if (!d) return ''
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

const ESSENTIAL_TOTAL = CRITICAL_TYPE_KEYS.length
const DISMISSED_PROMPTS_KEY = 'nwh-dismissed-prompts'

function readDismissed() {
  try {
    const raw = localStorage.getItem(DISMISSED_PROMPTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeDismissed(list) {
  try {
    localStorage.setItem(DISMISSED_PROMPTS_KEY, JSON.stringify(list))
  } catch {
    // best-effort persistence
  }
}

// Customer-facing role names (Family Graph spec / skill rule — never show the
// raw enum in the UI).
const ROLE_LABELS = {
  home_owner: 'Home Owner',
  circle_manager: 'Circle Manager',
  care_partner: 'Care Partner',
  service_partner: 'Service Partner',
  helper: 'Helper',
  family_member: 'Family Member',
  trusted_advisor: 'Trusted Advisor',
}

function formatDue(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  })
}

export default function Dashboard() {
  const { person } = useAuth()
  const { activeCircle, membership, applyCircleUpdate } = useCircle()
  const personId = person?.id

  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState(null)
  const [upcoming, setUpcoming] = useState([])
  const [openTasks, setOpenTasks] = useState([])
  const [hasFamily, setHasFamily] = useState(false)
  const [hasPlanItems, setHasPlanItems] = useState(false)
  const [contactsCount, setContactsCount] = useState(0)
  const [essentialsCovered, setEssentialsCovered] = useState(0)
  const [promptContext, setPromptContext] = useState(null)
  // Lazy initializer — localStorage is sync, no effect needed.
  const [dismissedPrompts, setDismissedPrompts] = useState(() => readDismissed())

  // Aware → Prepared conversion moment dismiss state. Lazy initializer reads
  // localStorage once; the setter below writes it back when the user clicks
  // "Remind me later", so the reveal stays hidden across sessions / refresh.
  const [revealDismissed, setRevealDismissed] = useState(
    () => typeof window !== 'undefined' &&
      window.localStorage.getItem('preparedRevealDismissed') === 'true'
  )

  // Render gate: real column is `subscription_tier` (the spec said `tier`).
  // After the rename in commit 6a574ea the value for the free tier is 'aware'.
  const showReveal =
    !revealDismissed && activeCircle?.subscription_tier === 'aware'

  function dismissReveal() {
    window.localStorage.setItem('preparedRevealDismissed', 'true')
    setRevealDismissed(true)
  }

  // PromptCard dismiss: append { id, dismissedAt } and persist. The engine
  // honors a 30-day TTL on dismissals, so the same prompt won't reappear
  // until then (and re-evaluation may pick a lower-priority one in the
  // meantime).
  function dismissPrompt(prompt) {
    setDismissedPrompts((prev) => {
      const next = [
        ...prev.filter((d) => d.id !== prompt.id),
        { id: prompt.id, dismissedAt: new Date().toISOString() },
      ]
      writeDismissed(next)
      return next
    })
  }

  const [trialLoading, setTrialLoading] = useState(false)
  const [trialError, setTrialError] = useState('')

  // Billing UI: paid-flow modal (PaymentModal) + downgrade confirmation.
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [downgradeOpen, setDowngradeOpen] = useState(false)
  // Toast shown after a successful upgrade, drives a one-shot success banner.
  const [paymentToast, setPaymentToast] = useState(false)
  // Stable "now" — lazy init keeps Date.now() out of render (impure).
  const [nowMs] = useState(() => Date.now())

  // Flip the active circle to Prepared and stamp a 30-day trial window.
  // Spec said `circles` — real table is `family_circles`. The reveal
  // unmounts as soon as the local cache shows subscription_tier='prepared'
  // (showReveal is derived from that field), so we apply the immutable
  // CircleContext patch right after the DB write rather than waiting on
  // a re-fetch. circles_update RLS already gates this to Family-write
  // roles, so the server enforces who's allowed to start the trial.
  async function handleStartTrial() {
    if (!activeCircle) return
    setTrialError('')
    setTrialLoading(true)

    const startedAt = new Date().toISOString()
    const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const patch = {
      subscription_tier: 'prepared',
      trial_started_at: startedAt,
      trial_ends_at: endsAt,
      // Initialize to {} so the cron (api/cron/send-trial-emails.mjs) can
      // treat trial_emails_sent as a plain object without null-handling.
      // Subsequent rows in the jsonb get stamped by the cron per send.
      trial_emails_sent: {},
      // billing_status='trial' is what the cron now filters on, and what
      // the trial status bar / expired interstitial keys off. Migration
      // 022 backfilled this for existing rows; new trials start it here.
      billing_status: 'trial',
    }

    const { error: trialErr } = await supabase
      .from('family_circles')
      .update(patch)
      .eq('id', activeCircle.id)

    if (trialErr) {
      console.error('Trial activation failed:', trialErr)
      setTrialError('Something went wrong. Please try again.')
      setTrialLoading(false)
      return
    }

    applyCircleUpdate(activeCircle.id, patch)
    setTrialLoading(false)
  }

  useEffect(() => {
    if (!activeCircle || !personId) return
    let cancelled = false
    supabase
      .from('circle_homes')
      .select('homes (*)')
      .eq('circle_id', activeCircle.id)
      .eq('status', 'active')
      .order('is_primary', { ascending: false })
      .then(async ({ data: ch }) => {
        if (cancelled) return
        const home = ch?.[0]?.homes ?? null
        // Family / plan-items signals for the PreparedReveal — count-only
        // queries (head: true) so we don't pull rows just to know "any".
        // Note: emergency_contacts still has no RLS policy yet — RLS in
        // deny-all mode returns count=0 without erroring, so the reveal
        // gracefully treats absence as "no items" until policies land.
        const [systemsR, schedR, safetyR, tasksR, familyR, docsR, contactsR] = await Promise.all([
          home
            ? supabase.from('home_systems').select('*').eq('home_id', home.id).eq('is_active', true)
            : Promise.resolve({ data: [] }),
          supabase
            .from('scheduled_maintenance')
            .select('*')
            .eq('circle_id', activeCircle.id)
            .eq('is_completed', false)
            .order('due_date', { ascending: true }),
          supabase.from('safety_checklist').select('item_key, is_complete').eq('circle_id', activeCircle.id),
          supabase
            .from('tasks')
            .select('id, title, status, due_date')
            .eq('circle_id', activeCircle.id)
            .neq('status', 'complete')
            .order('due_date', { ascending: true }),
          // Spec said `circle_members.user_id`; real schema is
          // circle_memberships.person_id. Excludes self so a solo owner
          // reads as "no family yet" (drives the Up next pill).
          supabase
            .from('circle_memberships')
            .select('id', { count: 'exact', head: true })
            .eq('circle_id', activeCircle.id)
            .in('status', ['active', 'invited'])
            .neq('person_id', personId),
          // document_type rows (not just count) so we can derive how many
          // distinct CRITICAL types are covered for the readiness card.
          supabase
            .from('documents')
            .select('document_type')
            .eq('circle_id', activeCircle.id)
            .eq('is_archived', false),
          supabase
            .from('emergency_contacts')
            .select('id', { count: 'exact', head: true })
            .eq('circle_id', activeCircle.id),
        ])
        if (cancelled) return
        const systems = systemsR.data ?? []
        const scheduled = schedR.data ?? []
        const safetyDone = (safetyR.data ?? []).filter((r) => r.is_complete).length
        setHealth(
          computeHomeHealth(home, systems, scheduled, {
            done: safetyDone,
            total: SAFETY_ITEMS.length,
          })
        )
        setUpcoming(scheduled.slice(0, 4))
        setOpenTasks(tasksR.data ?? [])
        setHasFamily((familyR.count ?? 0) > 0)
        const ecCount = contactsR.count ?? 0
        setContactsCount(ecCount)
        const docRows = docsR.data ?? []
        const presentTypes = new Set(docRows.map((d) => d.document_type))
        const covered = CRITICAL_TYPE_KEYS.filter((k) => presentTypes.has(k)).length
        setEssentialsCovered(covered)
        setHasPlanItems(docRows.length > 0 || ecCount > 0)

        // Build the prompt engine's context from data we already fetched.
        // No extra round-trips.
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const overdueMaint = scheduled.filter(
          (m) => m.due_date && new Date(m.due_date + 'T00:00:00') < today
        )
        const safetyDoneCount = (safetyR.data ?? []).filter((r) => r.is_complete).length
        setPromptContext({
          tier: activeCircle.subscription_tier,
          circleCreatedAt: activeCircle.created_at,
          trialStartedAt: activeCircle.trial_started_at,
          homeSystems: systems,
          overdueMaintenance: overdueMaint,
          safetyTotal: SAFETY_ITEMS.length,
          safetyDone: safetyDoneCount,
          contactsCount: ecCount,
          criticalDocsCovered: covered,
          tasksCount: (tasksR.data ?? []).length,
        })

        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle, personId])

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Welcome, {person?.first_name}</h1>
        <p>You don't have a Home Circle yet. Let's set one up.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen" role="status">
          <div className="loading-spinner" />
          <p>Loading dashboard…</p>
        </div>
      </div>
    )
  }

  // ── Billing/trial derived state ───────────────────────────────────────────
  // billing_status is the source of truth (NULL = no billing relationship,
  // 'trial' = inside or just past the 30-day trial, 'active' = paid).
  // nowMs is captured once at mount — Date.now() in render is impure per
  // the strict React-hooks ruleset. Few-minute drift is fine for trial UI;
  // a fresh load shows the up-to-date count.
  const billing = activeCircle.billing_status
  const trialEndsAt = activeCircle.trial_ends_at
    ? new Date(activeCircle.trial_ends_at)
    : null
  const trialExpired = trialEndsAt && trialEndsAt.getTime() <= nowMs
  const onTrial = billing === 'trial' && trialEndsAt
  const daysRemaining = onTrial
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - nowMs) / MS_PER_DAY))
    : null
  const trialActive = onTrial && !trialExpired
  const inWarnWindow = trialActive && daysRemaining <= TRIAL_WARN_DAYS
  const showExpiredInterstitial = onTrial && trialExpired

  // Charge amount + date for the new "your card will be charged $X on
  // DATE" copy in the trial bar. Falls back gracefully if the matrix
  // doesn't cover the user's tier (older rows without billing_cycle).
  const trialDaysTotal = activeCircle.trial_days || TRIAL_TOTAL_DAYS
  const trialCycle = activeCircle.billing_cycle === 'annual' ? 'annual' : 'monthly'
  const trialChargeAmount = trialActive
    ? TRIAL_CHARGE_AMOUNTS[activeCircle.subscription_tier]?.[trialCycle] ?? null
    : null
  const trialChargeAmountLabel = trialChargeAmount != null
    ? `${fmtMoney(trialChargeAmount)}${trialCycle === 'annual' ? ' (annual)' : ''}`
    : ''
  // Partner-trial day-60 banner: only on 90-day trials, only when
  // there are 30 or fewer days remaining.
  const showPartnerBanner =
    trialActive && trialDaysTotal === 90 && daysRemaining <= PARTNER_BANNER_DAYS_REMAINING

  // Trial-expired interstitial — replaces the normal dashboard content.
  if (showExpiredInterstitial) {
    return (
      <div className="page">
        <div className="trial-expired-card">
          <h1>Your free trial has ended</h1>
          <p className="trial-expired-body">
            You've built a great foundation. Keep your home record, documents,
            and family plan active with a Prepared membership.
          </p>
          <p className="trial-expired-price">$12/month · Cancel anytime</p>
          <button
            type="button"
            className="btn-primary-full"
            onClick={() => setPaymentOpen(true)}
          >
            Continue with Prepared →
          </button>
          <button
            type="button"
            className="btn-link trial-expired-downgrade"
            onClick={() => setDowngradeOpen(true)}
          >
            Continue with free Aware plan →
          </button>
        </div>

        <PaymentModal
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          onSuccess={() => setPaymentToast(true)}
        />
        <DowngradeConfirmModal
          open={downgradeOpen}
          onClose={() => setDowngradeOpen(false)}
          variant="aware"
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{activeCircle.name}</h1>
        <span className="role-badge">
          {ROLE_LABELS[membership?.role] ?? membership?.role}
        </span>
      </div>

      {paymentToast && (
        <div className="auth-notice" role="status">
          Welcome to Prepared! 🎉 Your subscription is active.
        </div>
      )}

      {showReveal && (
        <PreparedReveal
          score={health?.score ?? 0}
          hasFamily={hasFamily}
          hasPlanItems={hasPlanItems}
          onStartTrial={handleStartTrial}
          onDismiss={dismissReveal}
          loading={trialLoading}
          error={trialError}
        />
      )}

      <div className="dashboard-grid">
        <div className="dash-card dash-card-wide">
          <h3>Home Health</h3>
          <HealthScore health={health} />
        </div>

        {showPartnerBanner && (
          <div className="partner-trial-banner" role="status">
            Your trial ends in {daysRemaining} day{daysRemaining === 1 ? '' : 's'} —
            {' '}you'll be charged {trialChargeAmountLabel || '—'} on {fmtTrialDate(trialEndsAt)}.
            Cancel anytime in Settings.
          </div>
        )}
        {trialActive && (
          <div className={`trial-bar ${inWarnWindow ? 'trial-bar-warn' : 'trial-bar-ok'}`}>
            <div className="trial-bar-row">
              <span className="trial-bar-label">
                {daysRemaining} day{daysRemaining === 1 ? '' : 's'} left in your free trial
                {trialChargeAmount != null && trialEndsAt && (
                  <span className="trial-bar-charge">
                    {' — your card will be charged '}{trialChargeAmountLabel}{' on '}{fmtTrialDate(trialEndsAt)}
                  </span>
                )}
              </span>
              {inWarnWindow && (
                <button
                  type="button"
                  className="trial-bar-cta"
                  onClick={() => setPaymentOpen(true)}
                >
                  Add a payment method to continue →
                </button>
              )}
            </div>
            <div
              className="trial-bar-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={trialDaysTotal}
              aria-valuenow={trialDaysTotal - daysRemaining}
            >
              <div
                className="trial-bar-progress-fill"
                style={{ width: `${Math.min(100, ((trialDaysTotal - daysRemaining) / trialDaysTotal) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {(() => {
          if (!promptContext) return null
          const active = evaluatePrompt({ ...promptContext, dismissed: dismissedPrompts })
          return active ? (
            <PromptCard prompt={active} onDismiss={dismissPrompt} />
          ) : null
        })()}

        <div className="dash-card">
          <h3>Upcoming Maintenance</h3>
          {upcoming.length === 0 ? (
            <p className="dash-empty">Nothing scheduled</p>
          ) : (
            <ul className="dash-list">
              {upcoming.map((m) => (
                <li key={m.id} className="dash-list-row">
                  <span>{m.title}</span>
                  <span className="dash-list-meta">{formatDue(m.due_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link
          to="/tasks"
          className={`dash-card dash-card-link${openTasks.length === 0 ? ' dash-card-good' : ''}`}
        >
          <h3>Open Tasks</h3>
          {openTasks.length === 0 ? (
            <p className="dash-card-status dash-card-status-good">
              No open tasks ✓
            </p>
          ) : (
            <p className="dash-list-row">
              <span>
                {openTasks.length} {openTasks.length === 1 ? 'task' : 'tasks'} open
              </span>
            </p>
          )}
          <span className="dash-card-link-arrow" aria-hidden="true">Open list →</span>
        </Link>

        <Link to="/emergency-contacts" className="dash-card dash-card-link">
          <h3>Emergency Contacts</h3>
          {contactsCount > 0 ? (
            <p className="dash-list-row">
              <span>{contactsCount} {contactsCount === 1 ? 'contact' : 'contacts'} on file</span>
            </p>
          ) : (
            <p className="dash-empty">Add your first contact</p>
          )}
          <span className="dash-card-link-arrow" aria-hidden="true">View all →</span>
        </Link>

        {(() => {
          const tier = activeCircle?.subscription_tier
          const locked = tier === 'aware'
          const complete = !locked && essentialsCovered === ESSENTIAL_TOTAL && ESSENTIAL_TOTAL > 0
          const partial = !locked && essentialsCovered > 0 && !complete
          const empty = !locked && essentialsCovered === 0
          // State drives both the text and the card's left-accent color.
          const stateClass = locked
            ? 'dash-card-locked'
            : complete
              ? 'dash-card-good'
              : partial
                ? 'dash-card-warn'
                : ''
          return (
            <Link
              to="/documents"
              className={`dash-card dash-card-link ${stateClass}`.trim()}
            >
              <h3>Document Readiness</h3>
              {locked && (
                <p className="dash-list-row">
                  <span aria-hidden="true">🔒</span>
                  <span> Available with Prepared</span>
                </p>
              )}
              {complete && (
                <p className="dash-card-status dash-card-status-good">
                  Essential documents on file ✓
                </p>
              )}
              {partial && (
                <p className="dash-card-status dash-card-status-warn">
                  {essentialsCovered} of {ESSENTIAL_TOTAL} essential documents on file
                </p>
              )}
              {empty && (
                <p className="dash-empty">Add your first document</p>
              )}
              <span className="dash-card-link-arrow" aria-hidden="true">
                {locked ? 'Upgrade to Prepared →' : 'Open vault →'}
              </span>
            </Link>
          )
        })()}

        <div className="dash-card">
          <h3>Recent Activity</h3>
          <p className="dash-empty">Activity feed coming soon</p>
        </div>
      </div>

      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onSuccess={() => setPaymentToast(true)}
      />
    </div>
  )
}
