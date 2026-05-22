import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Recovery-flow landing page. The Supabase email "Reset password" link
// redirects here with hash params (#access_token=...&type=recovery&...).
// supabase-js parses the hash and fires events during client init —
// often BEFORE React mounts this page. So subscribing to
// onAuthStateChange first would miss the event entirely.
//
// Strategy: getSession() first (catches sessions already processed from
// the hash by the time we get here). If that returns nothing, fall back
// to onAuthStateChange for the rare timing where the event hasn't fired
// yet. A short readiness timeout flips to an "invalid link" CTA so a
// direct navigation (no recovery params) shows a useful message instead
// of leaving the user staring at a spinner.

const READINESS_TIMEOUT_MS = 4000

export default function ResetPassword() {
  const navigate = useNavigate()
  // 'pending' → 'ready' (form) or 'invalid' (expired/missing link).
  const [phase, setPhase] = useState('pending')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Track these in the outer closure so the useEffect cleanup can reach
    // them even though they're created inside the .then. Returning a
    // cleanup function from inside .then would not work — React only
    // honors the synchronous return of the effect callback.
    let subscription = null
    let timer = null

    function markReady() {
      if (cancelled) return
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      setPhase('ready')
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return

      // Path 1: supabase-js already processed the hash before we got
      // here — the recovery session is sitting in the client. Done.
      if (data?.session?.user) {
        markReady()
        return
      }

      // Path 2: the hash hasn't been processed yet. Subscribe for the
      // PASSWORD_RECOVERY event (or a late-arriving SIGNED_IN with a
      // live session — both indicate we can call updateUser).
      subscription = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
          markReady()
        }
      }).data.subscription

      // Path 3: nothing arrives at all → invalid link / direct nav.
      // Prev-callback guard so a late-firing event can't get clobbered
      // by the timeout if they race.
      timer = setTimeout(() => {
        if (cancelled) return
        setPhase((prev) => (prev === 'pending' ? 'invalid' : prev))
      }, READINESS_TIMEOUT_MS)
    })

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (subscription) subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Pick a password with at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError("Those don't match. Try again.")
      return
    }

    setSubmitting(true)
    const { error: updErr } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (updErr) {
      setError(updErr.message || 'Could not update your password. The link may have expired.')
      return
    }

    navigate('/dashboard', { replace: true })
  }

  if (phase === 'pending') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="loading-screen" role="status">
            <div className="loading-spinner" aria-hidden="true" />
            <p>Verifying your link…</p>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'invalid') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>This link has expired</h1>
          <p className="auth-subtitle">
            Reset links are only valid for one hour. Request a new one to continue.
          </p>
          <Link
            to="/forgot-password"
            className="btn-primary-full"
            style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}
          >
            Request a new link
          </Link>
          <div className="auth-links">
            <Link to="/login">← Back to Sign In</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Choose a new password</h1>
        <p className="auth-subtitle">
          Pick something at least 8 characters long. You'll be signed in right after.
        </p>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <label className="form-label">
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="form-input"
              placeholder="At least 8 characters"
            />
          </label>
          <label className="form-label">
            Confirm new password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="form-input"
              placeholder="Type it once more"
            />
          </label>

          <button
            type="submit"
            className="btn-primary-full"
            disabled={submitting || !password || !confirm}
          >
            {submitting ? 'Saving…' : 'Save new password'}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/login">← Back to Sign In</Link>
        </div>
      </div>
    </div>
  )
}
