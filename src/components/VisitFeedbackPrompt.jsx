import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCircle } from '../context/CircleContext'

// One-tap post-visit feedback. Renders only when the active circle has a
// completed visit in the last 7 days that hasn't been rated yet — and only
// for the actual homeowner (home_owner / circle_manager with
// relationship_kind = 'self'), not a remote family manager.
//
// Rating scale matches migration 051: 3 = great, 2 = good, 1 = needs attention.
const RATINGS = [
  { value: 3, emoji: '👍', label: 'Great' },
  { value: 2, emoji: '😐', label: 'Good' },
  { value: 1, emoji: '👎', label: 'Needs attention' },
]

const LOOKBACK_DAYS = 7
const FEEDBACK_MAX = 500

function dismissKey(visitId) {
  return `visited_feedback_dismissed_${visitId}`
}

function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

export default function VisitFeedbackPrompt() {
  const { activeCircle, membership } = useCircle()

  const [visit, setVisit] = useState(null)
  const [rating, setRating] = useState(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)     // true after a successful submit
  const [hidden, setHidden] = useState(false)  // true after skip / thank-you timeout

  // Only the actual homeowner sees this — not adult children managing a
  // parent's home (relationship_kind != 'self').
  const isHomeowner =
    membership?.relationship_kind === 'self' &&
    (membership?.role === 'home_owner' || membership?.role === 'circle_manager')

  // Single query on mount: most recent completed, unrated visit in the window.
  useEffect(() => {
    if (!isHomeowner || !activeCircle?.id) return
    let cancelled = false

    async function load() {
      const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)

      const { data } = await supabase
        .from('home_visits')
        .select('id, visit_date, tech_name')
        .eq('circle_id', activeCircle.id)
        .eq('status', 'complete')
        .gte('visit_date', cutoff)
        .is('homeowner_rating', null)
        .order('visit_date', { ascending: false })
        .limit(3)

      if (cancelled) return
      // First one the homeowner hasn't already skipped.
      const next = (data ?? []).find(
        (v) => !localStorage.getItem(dismissKey(v.id)),
      )
      setVisit(next ?? null)
    }

    load()
    return () => { cancelled = true }
  }, [isHomeowner, activeCircle?.id])

  // After a successful submit, hold the "Thank you!" briefly, then unmount.
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setHidden(true), 2500)
    return () => clearTimeout(t)
  }, [done])

  if (!isHomeowner || !visit || hidden) return null

  async function handleSubmit() {
    if (rating == null || submitting) return
    setSubmitting(true)
    const { error } = await supabase
      .from('home_visits')
      .update({
        homeowner_rating: rating,
        homeowner_feedback: comment.trim() ? comment.trim().slice(0, FEEDBACK_MAX) : null,
        homeowner_feedback_at: new Date().toISOString(),
      })
      .eq('id', visit.id)
    setSubmitting(false)
    if (!error) setDone(true)
  }

  function handleSkip() {
    localStorage.setItem(dismissKey(visit.id), '1')
    setHidden(true)
  }

  if (done) {
    return (
      <section className="homeowner-std-section" role="status" aria-live="polite">
        <h2 className="homeowner-std-h2">Thank you! 🙏</h2>
        <p className="homeowner-std-line">We appreciate you letting us know.</p>
      </section>
    )
  }

  return (
    <section className="homeowner-std-section">
      <h2 className="homeowner-std-h2">How was your recent visit?</h2>
      <p className="homeowner-std-line">
        {visit.tech_name ? `${visit.tech_name} visited` : 'Your home was visited'}
        {visit.visit_date ? ` on ${fmtDate(visit.visit_date)}` : ''}.
      </p>

      <div
        role="group"
        aria-label="Rate your visit"
        style={{ display: 'flex', gap: '0.75rem', margin: '1rem 0' }}
      >
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            aria-pressed={rating === r.value}
            onClick={() => setRating(r.value)}
            style={{
              flex: 1,
              minHeight: 56,
              padding: '0.85rem 0.5rem',
              borderRadius: 12,
              border: rating === r.value ? '2px solid #1D9E75' : '1px solid #D9E8ED',
              background: rating === r.value ? '#EAF7F1' : '#FFFFFF',
              color: '#3D2E2A',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: '1.75rem', lineHeight: 1 }}>
              {r.emoji}
            </span>
            {r.label}
          </button>
        ))}
      </div>

      <textarea
        className="form-input"
        rows={2}
        maxLength={FEEDBACK_MAX}
        placeholder="Anything else we should know? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        style={{ width: '100%' }}
      />

      <button
        type="button"
        className="tech-btn-primary"
        disabled={rating == null || submitting}
        onClick={handleSubmit}
        style={{ marginTop: '0.75rem' }}
      >
        {submitting ? 'Sending…' : 'Send feedback'}
      </button>

      <div style={{ marginTop: '0.6rem' }}>
        <button
          type="button"
          className="homeowner-std-link"
          onClick={handleSkip}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          Skip
        </button>
      </div>
    </section>
  )
}
