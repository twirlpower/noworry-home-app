import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ConsentBanner from '../components/ConsentBanner'
import { track } from '../lib/analytics'

export default function Signup() {
  const [step, setStep] = useState('identity') // identity → details → home
  const [setupType, setSetupType] = useState(null) // 'self' or 'other'
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handlePhoneChange(raw) {
    const digits = raw.replace(/\D/g, '').slice(0, 10)
    let formatted = digits
    if (digits.length >= 7) {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    } else if (digits.length >= 4) {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    } else if (digits.length >= 1) {
      formatted = `(${digits}`
    }
    setPhoneNumber(formatted)
  }
  const { signUp } = useAuth()
  const navigate = useNavigate()

  async function handleCreateAccount(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const phoneDigits = phoneNumber.replace(/\D/g, '')
    if (phoneDigits.length !== 10) {
      setError('Please enter a valid 10-digit US phone number.')
      setLoading(false)
      return
    }

    const { error: signUpError } = await signUp(email, password, firstName, lastName, phoneNumber)
    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
    } else {
      // Anon event — distinct_id stitches to the identified profile
      // once AuthContext fires identify() after the session resolves.
      track('user_signed_up', {
        signup_path: setupType === 'self' ? 'self' : 'on_behalf',
        source: 'direct',
      })
      // Navigate to onboarding flow based on setup type
      navigate('/onboarding', { state: { setupType } })
    }
  }

  // Step 1: Identity question
  if (step === 'identity') {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card-wide">
          <img src="/images/logo.png" alt="NoWorry Home" className="auth-logo" />
          <h1>Let's get started</h1>
          <p className="auth-subtitle">First, tell us who this is for.</p>

          <div className="path-cards">
            <button
              className={`path-card ${setupType === 'self' ? 'path-card-active' : ''}`}
              onClick={() => setSetupType('self')}
            >
              <span className="path-card-icon">🏡</span>
              <span className="path-card-label">I'm setting this up for myself</span>
              <span className="path-card-desc">
                I'm the homeowner and I'll manage my own Home Circle.
              </span>
            </button>

            <button
              className={`path-card ${setupType === 'other' ? 'path-card-active' : ''}`}
              onClick={() => setSetupType('other')}
            >
              <span className="path-card-icon">👨‍👩‍👧</span>
              <span className="path-card-label">I'm setting this up for someone else</span>
              <span className="path-card-desc">
                I'm helping a parent or family member get organized.
              </span>
            </button>
          </div>

          {setupType && (
            <button
              className="btn-primary-full"
              onClick={() => setStep('details')}
            >
              Continue
            </button>
          )}

          <div className="auth-links">
            <Link to="/login">Already have an account? Sign in</Link>
          </div>
        </div>
        <ConsentBanner />
      </div>
    )
  }

  // Step 2: Account details
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/images/logo.png" alt="NoWorry Home" className="auth-logo" />
        <h1>Create your account</h1>
        <p className="auth-subtitle">
          {setupType === 'self'
            ? 'You\'ll be the Home Owner and Circle Manager.'
            : 'You\'ll be the Circle Manager for your family member\'s home.'}
        </p>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <form onSubmit={handleCreateAccount}>
          <div className="form-row">
            <label className="form-label">
              First name
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="form-input"
              />
            </label>
            <label className="form-label">
              Last name
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className="form-input"
              />
            </label>
          </div>

          <label className="form-label">
            Phone
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => handlePhoneChange(e.target.value)}
              required
              className="form-input"
              placeholder="(303) 555-0100"
              autoComplete="tel"
              inputMode="numeric"
            />
          </label>

          <label className="form-label">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="form-input"
              placeholder="you@example.com"
            />
          </label>

          <label className="form-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="form-input"
              placeholder="At least 8 characters"
            />
          </label>

          <button type="submit" className="btn-primary-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <button className="btn-back" onClick={() => setStep('identity')}>
          ← Back
        </button>

        <div className="auth-links">
          <Link to="/login">Already have an account? Sign in</Link>
        </div>
      </div>
      <ConsentBanner />
    </div>
  )
}
