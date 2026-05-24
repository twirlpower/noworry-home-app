import { useEffect, useRef } from 'react'
import './PreparedReveal.css'
import { track } from '../lib/analytics'

// Aware → Prepared conversion moment. Approved-design build, see spec.
// Trigger gating lives in Dashboard (subscription_tier === 'aware' AND not
// dismissed in localStorage); this component is pure presentation given:
//   score        — integer 0–100
//   hasFamily    — boolean; any other circle member with status active|invited
//   hasPlanItems — boolean; any documents OR emergency_contacts row
//   onStartTrial — () => Promise<void> | void (CTA — Dashboard handles the
//                  tier flip; this component just reflects pending/error)
//   onDismiss    — () => void ("Remind me later")
//   loading      — boolean; CTA shows "Starting your trial…" + disabled
//   error        — string; non-empty renders an accessible-red message
//                  under the CTA (the only red in this UI, per spec)
//
// SVG ring math: stroke-dasharray = 314 (≈ 2πr for r=50), dashoffset shrinks
// linearly with score so 100 = full ring, 0 = empty. -90° rotation starts
// the stroke at 12 o'clock per spec.
export default function PreparedReveal({
  score,
  hasFamily,
  hasPlanItems,
  onStartTrial,
  onDismiss,
  loading = false,
  error = '',
}) {
  const safeScore = Math.max(0, Math.min(100, Math.round(score ?? 0)))
  const dashoffset = 314 * (1 - safeScore / 100)

  const planDone = !!hasPlanItems
  const familyDone = !!hasFamily

  // Fire reveal_moment_viewed exactly once per mount. useRef gate keeps
  // StrictMode's double-invoke in dev from sending the event twice.
  const viewedRef = useRef(false)
  useEffect(() => {
    if (viewedRef.current) return
    viewedRef.current = true
    track('reveal_moment_viewed', { home_health_score: safeScore })
  }, [safeScore])

  function handleCta() {
    track('reveal_moment_cta_clicked')
    onStartTrial?.()
  }

  return (
    <section className="prepared-reveal" aria-labelledby="prepared-reveal-title">
      <div className="pr-ring-wrap">
        <svg
          viewBox="0 0 120 120"
          className="pr-ring"
          role="img"
          aria-label={`Home health score ${safeScore} out of 100`}
        >
          <circle cx="60" cy="60" r="50" className="pr-ring-track" />
          <circle
            cx="60"
            cy="60"
            r="50"
            className="pr-ring-progress"
            strokeDasharray="314"
            strokeDashoffset={dashoffset}
            transform="rotate(-90 60 60)"
          />
          <text x="60" y="60" textAnchor="middle" dy="0.35em" className="pr-ring-score">
            {safeScore}
          </text>
        </svg>
        <p className="pr-ring-label">home health score</p>
      </div>

      <h2 id="prepared-reveal-title" className="pr-headline">
        You&apos;re off to a great start. Here&apos;s what&apos;s still ahead.
      </h2>
      <p className="pr-subtext">
        Your home profile is ready. The next step is making sure your family
        knows your plan — so they&apos;re never left guessing.
      </p>

      <ul className="pr-pills">
        <li className="pr-pill pr-pill-done">
          <span className="pr-pill-name">Your Home</span>
          <span className="pr-pill-tag">Done</span>
        </li>
        <li className={`pr-pill ${planDone ? 'pr-pill-done' : 'pr-pill-up-next'}`}>
          <span className="pr-pill-name">Your Plan</span>
          <span className="pr-pill-tag">{planDone ? 'Done' : 'Up next'}</span>
        </li>
        <li className={`pr-pill ${familyDone ? 'pr-pill-done' : 'pr-pill-up-next'}`}>
          <span className="pr-pill-name">Your Family</span>
          <span className="pr-pill-tag">{familyDone ? 'Done' : 'Up next'}</span>
        </li>
      </ul>

      <div className="pr-offer">
        <span className="pr-badge">Free for 30 days — no card needed</span>
        <h3 className="pr-offer-title">Get Prepared — and bring your family in</h3>
        <p className="pr-offer-body">
          Most families take about 15 minutes to set this up. Once it&apos;s done,
          everyone knows what to do — and you don&apos;t have to worry about
          explaining it.
        </p>
        <ul className="pr-features">
          <li>Store your will, POA, and insurance in one place</li>
          <li>Set your emergency contacts in priority order</li>
          <li>Invite family — each person sees what they need to</li>
          <li>Share tasks so nothing falls through the cracks</li>
          <li>Record your wishes and preferences — in your words</li>
        </ul>
        <button
          type="button"
          className="pr-cta"
          onClick={handleCta}
          disabled={loading}
          aria-busy={loading || undefined}
        >
          {loading ? 'Starting your trial…' : 'Try Prepared free for 30 days'}
        </button>
        {error && (
          <p className="pr-error" role="alert">{error}</p>
        )}
        <p className="pr-fine-print">
          $12/mo after your trial · Cancel anytime · No pressure
        </p>
      </div>

      <button
        type="button"
        className="pr-dismiss"
        onClick={onDismiss}
        disabled={loading}
      >
        Remind me later
      </button>
    </section>
  )
}
