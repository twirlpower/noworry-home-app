import posthog from 'posthog-js'

// PostHog analytics — single source of truth for tracking, identify, and
// consent. Every other file in the app should go through this module
// (track/identify/resetIdentity) rather than importing posthog-js
// directly, so we can swap providers or kill-switch capture from one
// place if needed.
//
// Naming convention (do not break): object_action (snake_case,
// past-tense verb). Properties: snake_case, no prefixes.

const POSTHOG_KEY  = import.meta.env.VITE_POSTHOG_KEY
const POSTHOG_HOST = 'https://us.i.posthog.com'
const CONSENT_KEY  = 'noworry:analytics-consent'

let initialized = false

export function initAnalytics() {
  if (initialized) return
  if (!POSTHOG_KEY) {
    // Quiet warning rather than throwing — local dev without a .env or
    // a misconfigured deploy shouldn't crash the app.
    console.warn('PostHog key not set — analytics disabled')
    return
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // Only mint a person profile once we call identify() — anon visitors
    // don't burn through the project quota.
    person_profiles: 'identified_only',
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '.sensitive',
    },
    // Share identity across noworry-home.com and app.noworry-home.com.
    cross_subdomain_cookie: true,
    persistence: 'localStorage+cookie',
    loaded: (ph) => {
      // Opt-in model — start opted out, flip on after the consent
      // banner gets an "Allow" click (or if the user already accepted
      // in a prior session).
      if (!getConsent()) ph.opt_out_capturing()
      else ph.opt_in_capturing()
    },
  })

  initialized = true
}

export function track(event, properties = {}) {
  if (!initialized) return
  posthog.capture(event, properties)
}

// Identify the current user. Safe to call repeatedly — PostHog dedupes
// by distinct_id. Pass the persons.id (NOT auth.uid()) so cross-session
// and cross-domain identity stitching works.
export function identify(personId, properties = {}) {
  if (!initialized || !personId) return
  posthog.identify(personId, properties)
}

// Merge additional properties onto the currently-identified user
// without re-asserting their distinct_id. Use this when tier / circle /
// role context lands after the initial identify.
export function updateUserProperties(properties = {}) {
  if (!initialized) return
  posthog.people.set(properties)
}

export function resetIdentity() {
  if (!initialized) return
  posthog.reset()
}

export function getConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'granted'
  } catch {
    return false
  }
}

export function hasAnsweredConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) !== null
  } catch {
    return false
  }
}

export function setConsent(granted) {
  try {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied')
  } catch {
    /* ignore — best effort */
  }
  if (!initialized) return
  if (granted) posthog.opt_in_capturing()
  else posthog.opt_out_capturing()
}
