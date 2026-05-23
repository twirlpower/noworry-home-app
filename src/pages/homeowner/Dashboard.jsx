import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCircle } from '../../context/CircleContext'
import { computeHomeHealth } from '../../lib/homeHealth'

// Homeowner view dashboard — Phase 3a.
// Emotional register: calm, dignified, simple. The 80-year-old
// homeowner should not feel like they've opened a dashboard. They've
// opened *their home*.
//
// Rules (Family Graph v1.1, Section 14):
//   - Hero element: Home Health Score, large, plain-language tone
//   - ONE primary thing visible at a time
//   - No coordination language ("tasks assigned", "family status feed")
//   - Body text ≥ 18px; headings ≥ 28px
//   - Tap targets ≥ 56px (larger than the 44px floor — these are older
//     users)
//   - Family activity present but secondary ("Your family is helping")

const TONE_PHRASE = {
  good: 'Looking great',
  fair: 'A few things to check',
  poor: "Let's get you back on track",
}

const TONE_BODY = {
  good: 'Your home is in good shape today. Everything important is taken care of.',
  fair: "A handful of items could use attention. Your family is on it.",
  poor: 'Some items need attention. Your family will help work through them.',
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

      // Inputs the health helper expects: systems, scheduled tasks,
      // safety items. Two parallel queries — cheap.
      const [systemsRes, schedRes, safetyRes] = await Promise.all([
        supabase.from('home_systems').select('*').eq('home_id', ch.homes.id).eq('is_active', true),
        supabase.from('scheduled_maintenance').select('*').eq('home_id', ch.homes.id).eq('status', 'open'),
        supabase.from('safety_status').select('done').eq('home_id', ch.homes.id),
      ])
      if (cancelled) return

      const safetyDone = (safetyRes?.data ?? []).filter((r) => r.done).length
      const safetyTotal = safetyRes?.data?.length ?? 0
      const result = computeHomeHealth(
        ch.homes,
        systemsRes?.data ?? [],
        schedRes?.data ?? [],
        { done: safetyDone, total: safetyTotal },
      )
      setScore(result.score)
      setTone(result.tone)

      // The one item to highlight: the nearest upcoming scheduled
      // maintenance. Plain-language phrasing, no urgency unless overdue.
      const upcoming = (schedRes?.data ?? [])
        .filter((s) => s.due_date)
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0]
      setNextItem(upcoming ?? null)
      setLoaded(true)
    }

    load()
    return () => { cancelled = true }
  }, [activeCircle?.id])

  if (!activeCircle) {
    return (
      <div className="homeowner-page">
        <h1 className="homeowner-h1">Welcome home</h1>
        <p className="homeowner-sub">Your home will appear here once it's set up.</p>
      </div>
    )
  }

  return (
    <div className="homeowner-page">
      <h1 className="homeowner-h1">
        Welcome home{person?.first_name ? `, ${person.first_name}` : ''}
      </h1>
      {loaded && tone && (
        <p className="homeowner-sub">{TONE_BODY[tone] ?? TONE_BODY.fair}</p>
      )}

      {/* Hero: home health score */}
      <section className={`homeowner-hero homeowner-hero-${tone}`}>
        <p className="homeowner-hero-label">Your home health</p>
        <div className="homeowner-hero-score">
          {score == null ? '—' : score}
        </div>
        <p className="homeowner-hero-phrase">
          {loaded ? (TONE_PHRASE[tone] ?? 'Checking in…') : 'Checking in…'}
        </p>
      </section>

      {/* ONE thing to know */}
      {nextItem && (
        <section className="homeowner-coming-up">
          <p className="homeowner-eyebrow">Coming up</p>
          <h2 className="homeowner-h2">{nextItem.title || 'A scheduled visit'}</h2>
          {nextItem.due_date && (
            <p className="homeowner-coming-when">
              {fmtMonthDay(nextItem.due_date)}
              {nextItem.description ? ` · ${nextItem.description}` : ''}
            </p>
          )}
          <p className="homeowner-coming-helper">
            Your family is taking care of the details.
          </p>
        </section>
      )}

      {/* Single primary action — keep modest */}
      <div className="homeowner-actions">
        <Link to="/home-profile" className="homeowner-cta">
          See your home details →
        </Link>
      </div>

      {/* Soft secondary — family is helping (NOT "your daughter did X") */}
      <p className="homeowner-helper-note">
        Your family has been helping behind the scenes.
      </p>
    </div>
  )
}
