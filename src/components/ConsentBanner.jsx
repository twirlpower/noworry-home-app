import { useEffect, useState } from 'react'
import { hasAnsweredConsent, setConsent } from '../lib/analytics'

// Privacy / analytics consent banner. Renders only on first visit
// (no stored answer in localStorage). Choice persists across sessions;
// can be changed later in Settings → Privacy.
//
// Rendered both inside AppShell (post-login) and on public auth pages
// (Login / Signup) so anonymous visitors get the choice too.

export default function ConsentBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (hasAnsweredConsent()) return
    // Brief delay so the banner doesn't compete with first paint or the
    // PWA install card. Both render fixed-position; the install card
    // already gates on an 8s delay, so the analytics banner appears
    // first and gets out of the way.
    const t = setTimeout(() => setShow(true), 1500)
    return () => clearTimeout(t)
  }, [])

  function answer(granted) {
    setConsent(granted)
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="consent-banner" role="dialog" aria-label="Privacy preferences">
      <h3 className="consent-banner-title">We respect your privacy</h3>
      <p className="consent-banner-body">
        We use analytics to understand how NoWorry Home is being used so we can
        make it better. We never sell your data, and you can change your mind
        anytime in Settings.
      </p>
      <div className="consent-banner-actions">
        <button
          type="button"
          className="consent-banner-allow"
          onClick={() => answer(true)}
        >
          Allow analytics
        </button>
        <button
          type="button"
          className="consent-banner-deny"
          onClick={() => answer(false)}
        >
          No thanks
        </button>
      </div>
    </div>
  )
}
