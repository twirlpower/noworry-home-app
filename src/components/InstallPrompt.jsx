import { useEffect, useState } from 'react'

// PWA install prompt. Shows a warm in-app card after the user has had
// a chance to engage with the app (~8s after mount), inviting them to
// add NoWorry Home to their home screen.
//
// Three platform paths:
//   * Already running as a standalone PWA → render nothing
//   * Android / desktop Chrome → capture beforeinstallprompt and surface
//     a native install button via deferredPrompt.prompt()
//   * iOS Safari → no event fires; show the Share → Add to Home Screen
//     instructions instead
//
// Dismissal persists per browser in localStorage so the prompt doesn't
// nag. Engagement-delay avoids the #1 reason people ignore PWA prompts
// (showing it before they've seen the app).

const STORAGE_KEY = 'noworry:install-prompt-dismissed'
const DELAY_MS = 8000

function isStandalone() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS Safari uses a non-standard property.
  if (window.navigator.standalone === true) return true
  return false
}

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [show, setShow] = useState(false)
  const [iosMode, setIosMode] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Don't show if dismissed previously.
    try {
      if (localStorage.getItem(STORAGE_KEY)) return
    } catch { /* localStorage unavailable — proceed */ }

    // Don't show if already installed.
    if (isStandalone()) return

    // iOS path — Safari doesn't fire beforeinstallprompt. Show manual
    // instructions after the engagement delay.
    if (isIOS()) {
      const t = setTimeout(() => {
        setIosMode(true)
        setShow(true)
      }, DELAY_MS)
      return () => clearTimeout(t)
    }

    // Android + desktop Chrome path — wait for the browser's event.
    function onBeforeInstall(e) {
      e.preventDefault()
      setDeferredPrompt(e)
      setTimeout(() => setShow(true), DELAY_MS)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShow(false)
      try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    }
    setDeferredPrompt(null)
  }

  function dismiss() {
    setShow(false)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
  }

  if (!show) return null

  return (
    <div className="install-prompt" role="dialog" aria-label="Install NoWorry Home">
      <div className="install-prompt-row">
        <div className="install-prompt-icon" aria-hidden="true">🏡</div>
        <div className="install-prompt-body">
          <h3 className="install-prompt-title">
            Add NoWorry Home to your home screen
          </h3>

          {iosMode ? (
            <p className="install-prompt-text">
              Tap the <strong>Share</strong> button below, then{' '}
              <strong>Add to Home Screen</strong> — and NoWorry Home opens
              like an app, right from your phone.
            </p>
          ) : (
            <p className="install-prompt-text">
              Get to your home, your family, and your peace of mind with one
              tap. No browser. No fuss.
            </p>
          )}

          <div className="install-prompt-actions">
            {!iosMode && (
              <button
                type="button"
                className="install-prompt-primary"
                onClick={handleInstall}
              >
                Add to home screen
              </button>
            )}
            <button
              type="button"
              className="install-prompt-secondary"
              onClick={dismiss}
            >
              {iosMode ? 'Got it' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
