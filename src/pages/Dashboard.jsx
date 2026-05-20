import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { computeHomeHealth } from '../lib/homeHealth'
import { SAFETY_ITEMS } from '../lib/safetyItems'
import HealthScore from '../components/HealthScore'
import PreparedReveal from '../components/PreparedReveal'

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

  const [trialLoading, setTrialLoading] = useState(false)
  const [trialError, setTrialError] = useState('')

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
          supabase
            .from('documents')
            .select('id', { count: 'exact', head: true })
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
        setHasPlanItems((docsR.count ?? 0) > 0 || (contactsR.count ?? 0) > 0)
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

  return (
    <div className="page">
      <div className="page-header">
        <h1>{activeCircle.name}</h1>
        <span className="role-badge">
          {ROLE_LABELS[membership?.role] ?? membership?.role}
        </span>
      </div>

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

        <div className="dash-card">
          <h3>Open Tasks</h3>
          {openTasks.length === 0 ? (
            <p className="dash-empty">No open tasks</p>
          ) : (
            <ul className="dash-list">
              {openTasks.slice(0, 5).map((t) => (
                <li key={t.id} className="dash-list-row">
                  <span>{t.title}</span>
                  {t.due_date && (
                    <span className="dash-list-meta">{formatDue(t.due_date)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-card">
          <h3>Recent Activity</h3>
          <p className="dash-empty">Activity feed coming soon</p>
        </div>
      </div>
    </div>
  )
}
