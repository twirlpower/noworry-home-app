import { useEffect, useState } from 'react'
import { track } from '../lib/analytics'

function platformLabel() {
  if (typeof navigator === 'undefined') return 'unknown'
  // Samsung first — its UA also matches /android/, but we want the more
  // specific bucket for analytics consistency with the manual-hint path.
  if (/SamsungBrowser/i.test(navigator.userAgent)) return 'samsung'
  if (/android/i.test(navigator.userAgent)) return 'android'
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return 'ios'
  return 'desktop'
}

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

// Samsung Internet is Chromium-based but doesn't reliably fire
// beforeinstallprompt — users on default Galaxy phones get no prompt.
// Treat them like iOS Safari: show manual Add-to-Home-Screen
// instructions instead of waiting forever for an event that won't come.
function isSamsungBrowser() {
  if (typeof navigator === 'undefined') return false
  return /SamsungBrowser/i.test(navigator.userAgent)
}

// Phones and tablets only — desktop visitors get nothing (they're unlikely
// to install a home-screen icon and the banner just adds noise). Touch-as-
// primary-input is the cleanest signal; UA sniff is a fallback for browsers
// missing the media query.
function isMobileOrTablet() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(pointer: coarse)')?.matches) return true
  if (typeof navigator !== 'undefined' &&
      /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)) {
    return true
  }
  return false
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [show, setShow] = useState(false)
  // null  → show native install button (we have a deferredPrompt to fire)
  // 'ios' / 'samsung' → show manual Add-to-Home-Screen instructions
  const [manualHint, setManualHint] = useState(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Debug escape hatch — visiting any page with ?reset-pwa-prompt=true
    // clears the dismissed flag so the prompt fires again on this device
    // without having to wipe browser storage. Useful for QA on a single
    // Samsung phone where the previous dismissal needs to be re-tested.
    try {
      if (new URLSearchParams(window.location.search).get('reset-pwa-prompt') === 'true') {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch { /* ignore — proceed with normal flow */ }
    // Don't show if dismissed previously.
    try {
      if (localStorage.getItem(STORAGE_KEY)) return
    } catch { /* localStorage unavailable — proceed */ }

    // Don't show if already installed.
    if (isStandalone()) return

    // Don't show on desktop — the "add to home screen" framing makes no
    // sense there, and desktop visitors typically aren't the target.
    if (!isMobileOrTablet()) return

    // iOS path — Safari doesn't fire beforeinstallprompt. Show manual
    // instructions after the engagement delay.
    if (isIOS()) {
      const t = setTimeout(() => {
        setManualHint('ios')
        setShow(true)
        track('pwa_install_prompted', { platform: 'ios' })
      }, DELAY_MS)
      return () => clearTimeout(t)
    }

    // Samsung Internet path — Chromium-based but doesn't reliably fire
    // beforeinstallprompt. Show manual instructions, same as iOS.
    if (isSamsungBrowser()) {
      const t = setTimeout(() => {
        setManualHint('samsung')
        setShow(true)
        track('pwa_install_prompted', { platform: 'samsung' })
      }, DELAY_MS)
      return () => clearTimeout(t)
    }

    // Android Chrome + desktop Chrome path — wait for the browser's event.
    function onBeforeInstall(e) {
      e.preventDefault()
      setDeferredPrompt(e)
      setTimeout(() => {
        setShow(true)
        track('pwa_install_prompted', { platform: platformLabel() })
      }, DELAY_MS)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    const platform = platformLabel()
    if (outcome === 'accepted') {
      setShow(false)
      try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
      track('pwa_install_accepted', { platform })
    } else {
      track('pwa_install_dismissed', { platform })
    }
    setDeferredPrompt(null)
  }

  function dismiss() {
    setShow(false)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    track('pwa_install_dismissed', { platform: platformLabel() })
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

          {manualHint === 'ios' && (
            <p className="install-prompt-text">
              Tap the <strong>Share</strong> button below, then{' '}
              <strong>Add to Home Screen</strong> — and NoWorry Home opens
              like an app, right from your phone.
            </p>
          )}
          {manualHint === 'samsung' && (
            <p className="install-prompt-text">
              Tap the <strong>menu</strong> at the bottom of your browser,
              then <strong>Add page to → Home screen</strong> — and NoWorry
              Home opens like an app, right from your phone.
            </p>
          )}
          {manualHint === null && (
            <p className="install-prompt-text">
              Get to your home, your family, and your peace of mind with one
              tap. No browser. No fuss.
            </p>
          )}

          <div className="install-prompt-actions">
            {manualHint === null && (
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
              {manualHint ? 'Got it' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
