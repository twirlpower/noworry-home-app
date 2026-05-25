import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCircle } from '../../context/CircleContext'
import { computeHomeHealth } from '../../lib/homeHealth'
import { SAFETY_ITEMS } from '../../lib/safetyItems'

// Homeowner view dashboard — Phase 3a, refined per the May 24 board
// decision ("Fix Simple"). Sparse is not the same as simple. The
// 80-year-old homeowner should open this and feel like someone has
// her back, not like she opened a half-finished app:
//   - Warm plain-language interpretation of the health score
//   - "Your family is helping" with first names — she is not alone
//   - Ownership clarity on the one upcoming item (who has it)
//   - A warm empty state when there's nothing scheduled
//   - No task list, no coordination language, no admin surfaces.
//
// Tap targets ≥ 56px, body ≥ 18px, score ≥ 72px, all text ≥ #555
// equivalent (the --muted / --text / --deep tokens all clear that).

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

export default function HomeownerDashboard() {
  const { person } = useAuth()
  const { activeCircle } = useCircle()

  const [score, setScore] = useState(null)
  const [tone, setTone] = useState('fair')
  const [nextItem, setNextItem] = useState(null)
  const [carePartnerNames, setCarePartnerNames] = useState([])
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

      // Four parallel queries: health inputs (systems / scheduled /
      // safety) plus care-partner roster for the family-help message.
      const [systemsRes, schedRes, safetyRes, partnersRes] = await Promise.all([
        supabase.from('home_systems').select('*').eq('home_id', ch.homes.id).eq('is_active', true),
        supabase.from('scheduled_maintenance').select('*').eq('home_id', ch.homes.id).eq('status', 'open'),
        supabase.from('safety_checklist').select('item_key, is_complete').eq('circle_id', activeCircle.id),
        supabase
          .from('circle_memberships')
          .select('person_id, role, persons!person_id (first_name)')
          .eq('circle_id', activeCircle.id)
          .eq('status', 'active')
          .in('role', ['care_partner', 'circle_manager', 'care_coordinator']),
      ])
      if (cancelled) return

      const safetyDone = (safetyRes?.data ?? []).filter((r) => r.is_complete).length
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

      // The one item to highlight: the nearest upcoming scheduled
      // maintenance. Plain-language phrasing, no urgency unless overdue.
      const upcoming = (schedRes?.data ?? [])
        .filter((s) => s.due_date)
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0]
      setNextItem(upcoming ?? null)

      // Care partners minus the reader herself. circle_manager is
      // included on purpose — they're often the adult child who
      // actually owns the day-to-day, and the homeowner thinks of
      // them as family, not as an admin.
      const names = (partnersRes?.data ?? [])
        .filter((m) => m.person_id !== person?.id)
        .map((m) => m.persons?.first_name)
        .filter(Boolean)
      setCarePartnerNames(names)

      setLoaded(true)
    }

    load()
    return () => { cancelled = true }
  }, [activeCircle?.id, person?.id])

  if (!activeCircle) {
    return (
      <div className="homeowner-page">
        <h1 className="homeowner-h1">Welcome home</h1>
        <p className="homeowner-sub">Your home will appear here once it's set up.</p>
      </div>
    )
  }

  const familyHelpMessage = getFamilyHelpMessage(carePartnerNames)
  const primaryPartnerName = carePartnerNames[0] ?? null

  return (
    <div className="homeowner-page">
      <h1 className="homeowner-h1">
        Welcome home{person?.first_name ? `, ${person.first_name}` : ''}
      </h1>

      {/* Hero: home health score + warm interpretation. The hero's
          background color is driven by the existing tone classes
          (good/fair/poor); the sentence below is keyed off the finer
          score bands the board specified. */}
      <section className={`homeowner-hero homeowner-hero-${tone}`}>
        <p className="homeowner-hero-label">Home Health Score</p>
        <div className="homeowner-hero-score">
          {score == null ? '—' : score}
        </div>
        <p className="homeowner-hero-message">
          {loaded ? getScoreMessage(score) : 'Checking on your home…'}
        </p>
      </section>

      {/* Family is helping — the most important emotional signal.
          Renders only when there's at least one care partner. */}
      {loaded && familyHelpMessage && (
        <p className="homeowner-family-help">
          <span className="homeowner-family-help-icon" aria-hidden="true">🤝</span>
          {familyHelpMessage}
        </p>
      )}

      {/* ONE thing to know — what's next, when, and who has it. */}
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

      {/* Warm empty state — silence isn't reassuring, a sentence is. */}
      {loaded && !nextItem && (
        <section className="homeowner-empty">
          <p className="homeowner-empty-icon" aria-hidden="true">✅</p>
          <p className="homeowner-empty-title">Nothing coming up right now</p>
          <p className="homeowner-empty-sub">Your home is all caught up.</p>
        </section>
      )}
    </div>
  )
}
