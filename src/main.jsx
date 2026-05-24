import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initAnalytics, track } from './lib/analytics'
import './index.css'

// Initialize PostHog before render so the loaded() callback can honor
// any prior consent state from this browser before the first pageview
// autocapture fires.
initAnalytics()

// Fire app_launched_standalone exactly when the user opens the
// installed PWA (display-mode: standalone). Browser tab loads don't
// count. Capture suppression respects consent automatically.
if (typeof window !== 'undefined') {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  if (standalone) {
    let platform = 'desktop'
    if (typeof navigator !== 'undefined') {
      if (/android/i.test(navigator.userAgent)) platform = 'android'
      else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) platform = 'ios'
    }
    track('app_launched_standalone', { platform })
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// PWA service worker — production only. Registering in dev confuses
// Vite's HMR (it caches modules the dev server is mid-replacing) and
// surfaces stale-asset bugs that don't exist in real builds.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err)
    })
  })
}
