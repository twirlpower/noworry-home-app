import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCircle } from '../../context/CircleContext'
import { useView } from '../../context/ViewContext'
import { computeHomeHealth } from '../../lib/homeHealth'
import { SAFETY_ITEMS } from '../../lib/safetyItems'
import { getHomeDisplayName } from '../../utils/homeDisplayName'
import WelcomeMessage from '../../components/WelcomeMessage'
import VisitFeedbackPrompt from '../../components/VisitFeedbackPrompt'

// Homeowner view dashboard.
//
// Phase 3a shipped the Simple-only layout.
// Phase 1 fix added the warm score interpretation, family-help signal,
// ownership clarity on the coming-up card, and the warm empty state.
// Phase 3c adds the Standard layout — same hero + family signal up
// top, then a fuller maintenance list, safety progress, and a recent
// activity feed — gated by persons.homeowner_view_preference.
//
// The view density is per-person, not per-circle: a homeowner who
// belongs to multiple circles sees the same density everywhere. The
// preference is loaded by ViewContext when activeView === 'homeowner',
// and the bottom-of-page toggle calls setHomeownerViewMode() which
// writes through to the DB.
//
// Both modes preserve the Phase-1-fix discipline:
//   - Tap targets ≥ 56px, body ≥ 18px, score ≥ 72px
//   - Text never lighter than the --muted token (#6A5A52)
//   - No coordination language ("assign", "create task"), no admin
//     surfaces, no alert tone. Everything is "things to know" not
//     "things to do."

const HEALTH_LOOKBACK_DAYS = 60
const ACTIVITY_LOOKBACK_DAYS = 30
const COMING_UP_MAX_ITEMS = 5
const ACTIVITY_MAX_ITEMS = 3

// Score-band interpretation. Finer-grained than the three tone bands
// in computeHomeHealth() — the board wanted a warm sentence per
// range, not a one-word label. Tone (good/fair/poor) still drives
// the card's background color via the existing CSS classes.
function getScoreMessage(score) {
  if (score == null) return 'Checking on your home…'
  if (score >= 85) return 'Your home is in great shape.'
  if (score >= 70) return 'Your home is doing well — a few things to keep an eye on.'
  if (score >= 55) return 'Your home needs some attention in a couple of areas.'
  return 'Your home has some things that need attention soon.'
}

// Build a warm helper line naming the people pitching in. Excludes
// the homeowner herself so the copy doesn't read "Margaret is helping
// keep an eye on things" when Margaret is reading it.
function getFamilyHelpMessage(names) {
  if (!names || names.length === 0) return null
  if (names.length === 1) return `${names[0]} is helping keep an eye on things.`
  if (names.length === 2) return `${names[0]} and ${names[1]} are helping keep an eye on things.`
  return `${names[0]} and ${names.length - 1} others are helping keep an eye on things.`
}

function fmtMonthDay(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

// Standard-view header date — "Sunday, May 25" style. Always uses the
// reader's locale; falls back gracefully if Intl is unavailable.
function fmtLongDay(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function HomeownerDashboard() {
  const { person } = useAuth()
  const { activeCircle, membership } = useCircle()
  const { homeownerViewMode, setHomeownerViewMode } = useView()

  const [score, setScore] = useState(null)
  const [tone, setTone] = useState('fair')
  const [scheduled, setScheduled] = useState([])
  const [safetyStats, setSafetyStats] = useState({ done: 0, nextLabel: null })
  const [carePartnerNames, setCarePartnerNames] = useState([])
  const [recentNotes, setRecentNotes] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!activeCircle?.id) return
    let cancelled = false

    async function load() {
      // Resolve the primary home for this circle.
      const { data: ch } = await supabase
        .from('circle_homes')
        .select('homes(*)')
        .eq('circle_id', activeCircle.id)
        .eq('status', 'active')
        .eq('is_primary', true)
        .maybeSingle()

      if (cancelled || !ch?.homes) {
        setLoaded(true)
        return
      }

      // Five parallel queries: health inputs (systems / scheduled /
      // safety) plus the care-partner roster for the family-help line
      // and the recent-notes feed for the Standard activity panel.
      //
      // scheduled_maintenance filter note: the original query used
      // .eq('status', 'open'), but the table has no status column —
      // is_completed (boolean) is the correct filter. The bad filter
      // returned an error → silently empty array → the coming-up
      // card never rendered. Fixed here as a prerequisite for the
      // Standard layout, which depends on real maintenance data.
      const sinceActivity = new Date(
        Date.now() - ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString()
      const [systemsRes, schedRes, safetyRes, partnersRes, notesRes] = await Promise.all([
        supabase.from('home_systems').select('*').eq('home_id', ch.homes.id).eq('is_active', true),
        supabase.from('scheduled_maintenance').select('*').eq('home_id', ch.homes.id).eq('is_completed', false),
        supabase.from('safety_checklist').select('item_key, is_complete').eq('circle_id', activeCircle.id),
        supabase
          .from('circle_memberships')
          .select('person_id, role, persons!person_id (first_name)')
          .eq('circle_id', activeCircle.id)
          .eq('status', 'active')
          .in('role', ['care_partner', 'circle_manager', 'care_coordinator']),
        supabase
          .from('notes')
          .select('id, content, created_at, author:persons!author_id (first_name)')
          .eq('circle_id', activeCircle.id)
          .gte('created_at', sinceActivity)
          .order('created_at', { ascending: false })
          .limit(ACTIVITY_MAX_ITEMS + 3),
      ])
      if (cancelled) return

      const safetyRows = safetyRes?.data ?? []
      const completedKeys = new Set(
        safetyRows.filter((r) => r.is_complete).map((r) => r.item_key),
      )
      const safetyDone = completedKeys.size
      // Denominator is the static universe of safety items, not the DB
      // row count. safety_checklist only stores rows for items the user
      // has touched — using row count would always yield "done = total"
      // once anything was completed.
      const result = computeHomeHealth(
        ch.homes,
        systemsRes?.data ?? [],
        schedRes?.data ?? [],
        { done: safetyDone, total: SAFETY_ITEMS.length },
      )
      setScore(result.score)
      setTone(result.tone)

      // Pick the first incomplete safety item in canonical order so the
      // Standard panel's "Next" nudge stays stable across renders.
      const nextSafety = SAFETY_ITEMS.find((it) => !completedKeys.has(it.key))
      setSafetyStats({
        done: safetyDone,
        nextLabel: nextSafety?.label ?? null,
      })

      // Coming-up list: not-yet-completed scheduled maintenance with a
      // due date in the next HEALTH_LOOKBACK_DAYS window, sorted soonest
      // first. The list is what the Standard view shows; the Simple
      // view picks the first item off this same list as nextItem.
      const horizon = new Date()
      horizon.setDate(horizon.getDate() + HEALTH_LOOKBACK_DAYS)
      const upcoming = (schedRes?.data ?? [])
        .filter((s) => s.due_date && new Date(s.due_date) <= horizon)
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      setScheduled(upcoming)

      // Care partners minus the reader herself. circle_manager is
      // included on purpose — they're often the adult child who
      // actually owns the day-to-day, and the homeowner thinks of
      // them as family, not as an admin.
      const names = (partnersRes?.data ?? [])
        .filter((m) => m.person_id !== person?.id)
        .map((m) => m.persons?.first_name)
        .filter(Boolean)
      setCarePartnerNames(names)

      // Recent activity for Standard view: notes posted by other
      // members in the last 30 days. We over-fetch by a couple so
      // we can drop the homeowner's own posts ("you posted") and
      // still hit ACTIVITY_MAX_ITEMS most of the time.
      const notes = (notesRes?.data ?? [])
        .filter((n) => n.author?.first_name && n.author.first_name !== person?.first_name)
        .slice(0, ACTIVITY_MAX_ITEMS)
      setRecentNotes(notes)

      setLoaded(true)
    }

    load()
    return () => { cancelled = true }
  }, [activeCircle?.id, person?.id, person?.first_name])

  if (!activeCircle) {
    return (
      <div className="homeowner-page">
        <h1 className="homeowner-h1">Welcome home</h1>
        <p className="homeowner-sub">Your home will appear here once it&apos;s set up.</p>
      </div>
    )
  }

  const familyHelpMessage = getFamilyHelpMessage(carePartnerNames)
  const primaryPartnerName = carePartnerNames[0] ?? null
  const nextItem = scheduled[0] ?? null
  const homeLabel = getHomeDisplayName(
    membership?.relationship_kind,
    membership?.homeowners ?? [],
    activeCircle?.name,
  )

  // Shared hero + family signal block — identical in both layouts.
  const hero = (
    <>
      <section className={`homeowner-hero homeowner-hero-${tone}`}>
        {homeLabel && (
          <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', opacity: 0.65, margin: '0 0 0.6rem' }}>
            {homeLabel}
          </p>
        )}
        <p className="homeowner-hero-label">Home Health Score</p>
        <div className="homeowner-hero-score">
          {score == null ? '—' : score}
        </div>
        <p className="homeowner-hero-message">
          {loaded ? getScoreMessage(score) : 'Checking on your home…'}
        </p>
      </section>

      {loaded && familyHelpMessage && (
        <p className="homeowner-family-help">
          <span className="homeowner-family-help-icon" aria-hidden="true">🤝</span>
          {familyHelpMessage}
        </p>
      )}
    </>
  )

  // Bottom-of-page density toggle. Subtle on purpose — homeowner can
  // flip but isn't pushed toward either mode. Writes through to
  // persons.homeowner_view_preference via the ViewContext setter.
  const densityToggle = (
    <div className="homeowner-density-toggle">
      <button
        type="button"
        className="homeowner-density-toggle-btn"
        onClick={() =>
          setHomeownerViewMode(homeownerViewMode === 'simple' ? 'standard' : 'simple')
        }
      >
        {homeownerViewMode === 'simple'
          ? 'Switch to the full picture'
          : 'Switch to a simpler view'}
      </button>
    </div>
  )

  if (homeownerViewMode === 'simple') {
    return (
      <div className="homeowner-page">
        <WelcomeMessage />
        <h1 className="homeowner-h1">
          Welcome home{person?.first_name ? `, ${person.first_name}` : ''}
        </h1>
        <VisitFeedbackPrompt />
        {hero}

        {nextItem && (
          <section className="homeowner-coming-up">
            <p className="homeowner-eyebrow">Coming up</p>
            <h2 className="homeowner-h2">{nextItem.title || 'A scheduled visit'}</h2>
            <p className="homeowner-coming-when">
              {fmtMonthDay(nextItem.due_date)}
              {primaryPartnerName
                ? ` · ${primaryPartnerName} has this scheduled`
                : ' · No one assigned yet'}
            </p>
          </section>
        )}

        {loaded && !nextItem && (
          <section className="homeowner-empty">
            <p className="homeowner-empty-icon" aria-hidden="true">✅</p>
            <p className="homeowner-empty-title">Nothing coming up right now</p>
            <p className="homeowner-empty-sub">Your home is all caught up.</p>
          </section>
        )}

        {densityToggle}
      </div>
    )
  }

  // Standard view — same emotional opening (hero + family signal),
  // then maintenance, safety, and the activity feed. Read-only by
  // design: "things to know" not "things to do."
  const safetyPct = Math.round((safetyStats.done / SAFETY_ITEMS.length) * 100)

  return (
    <div className="homeowner-page">
      <WelcomeMessage />
      <h1 className="homeowner-h1">
        Welcome home{person?.first_name ? `, ${person.first_name}` : ''}
      </h1>
      <p className="homeowner-std-date">{fmtLongDay(new Date())}</p>

      <VisitFeedbackPrompt />
      {hero}

      {/* Maintenance — next 60 days, up to 5 items */}
      <section className="homeowner-std-section">
        <h2 className="homeowner-std-h2">Coming up</h2>
        {scheduled.length === 0 && loaded ? (
          <p className="homeowner-std-empty">
            Nothing scheduled in the next two months — your home is all caught up.
          </p>
        ) : (
          <>
            <ul className="homeowner-std-list">
              {scheduled.slice(0, COMING_UP_MAX_ITEMS).map((item) => (
                <li key={item.id} className="homeowner-std-list-item">
                  <span className="homeowner-std-item-title">
                    {item.title || 'A scheduled visit'}
                  </span>
                  <span className="homeowner-std-item-meta">
                    {fmtMonthDay(item.due_date)}
                    {primaryPartnerName
                      ? ` · ${primaryPartnerName} is helping with this`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
            {scheduled.length > COMING_UP_MAX_ITEMS && (
              <Link to="/maintenance" className="homeowner-std-link">
                See the full schedule →
              </Link>
            )}
          </>
        )}
      </section>

      {/* Safety — progress + the next thing to check */}
      <section className="homeowner-std-section">
        <h2 className="homeowner-std-h2">Home safety</h2>
        <p className="homeowner-std-line">
          <strong>{safetyStats.done}</strong> of {SAFETY_ITEMS.length} items complete
          {SAFETY_ITEMS.length > 0 && ` · ${safetyPct}%`}
        </p>
        {safetyStats.nextLabel ? (
          <p className="homeowner-std-line">
            Next: {safetyStats.nextLabel}
          </p>
        ) : (
          <p className="homeowner-std-line">Everything checked off — nicely done.</p>
        )}
        <Link to="/safety" className="homeowner-std-link">
          See the safety checklist →
        </Link>
      </section>

      {/* Family activity — last few notes from other members */}
      {recentNotes.length > 0 && (
        <section className="homeowner-std-section">
          <h2 className="homeowner-std-h2">Your family has been busy</h2>
          <ul className="homeowner-std-list">
            {recentNotes.map((n) => (
              <li key={n.id} className="homeowner-std-list-item">
                <span className="homeowner-std-item-title">
                  {n.author?.first_name} posted an update
                </span>
                <span className="homeowner-std-item-meta">
                  {n.content?.slice(0, 100)}{n.content?.length > 100 ? '…' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {densityToggle}
    </div>
  )
}
