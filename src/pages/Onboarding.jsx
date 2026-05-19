import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'

export default function Onboarding() {
  const location = useLocation()
  const navigate = useNavigate()
  const { person } = useAuth()
  const { reloadCircles } = useCircle()
  const setupType = location.state?.setupType || 'self'

  const [step, setStep] = useState(setupType === 'other' ? 'homeowner' : 'home')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Home Owner info (for "setting up for someone else")
  const [ownerFirst, setOwnerFirst] = useState('')
  const [ownerLast, setOwnerLast] = useState('')
  const [ownerRelationship, setOwnerRelationship] = useState('')

  // Home profile
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('CO')
  const [zip, setZip] = useState('')
  const [yearBuilt, setYearBuilt] = useState('')
  const [sqft, setSqft] = useState('')
  const [bedrooms, setBedrooms] = useState('')
  const [bathrooms, setBathrooms] = useState('')

  async function handleComplete(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!person) {
      setError(
        'Your account is signed in but your profile record is missing. ' +
        'This usually means the database setup is incomplete — sign out, ' +
        'create a fresh account, and try again.'
      )
      setLoading(false)
      return
    }

    const circleName = setupType === 'other'
      ? `${ownerFirst}'s Home Circle`
      : `${person.first_name}'s Home Circle`

    // Single atomic RPC — creates home, circle, link, and memberships in one
    // transaction (SECURITY DEFINER, so it isn't blocked by the RLS bootstrap
    // chicken-and-egg). See docs/rls_policies_v1.sql.
    const { error: rpcError } = await supabase.rpc('setup_home_circle', {
      p_setup_type: setupType,
      p_circle_name: circleName,
      p_home: {
        address_line1: address,
        address_line2: '',
        city,
        state,
        zip,
        year_built: yearBuilt,
        square_feet: sqft,
        bedrooms,
        bathrooms,
      },
      p_owner_first: setupType === 'other' ? ownerFirst : null,
      p_owner_last: setupType === 'other' ? ownerLast : null,
      p_owner_relationship: setupType === 'other' ? ownerRelationship : null,
    })

    if (rpcError) {
      setError(rpcError.message || 'Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    await reloadCircles()
    navigate('/dashboard')
  }

  // Step: Home Owner info (only for "setting up for someone else")
  if (step === 'homeowner') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Who are you setting this up for?</h1>
          <p className="auth-subtitle">
            Tell us about the person whose home you're helping manage.
            They don't need to create an account.
          </p>

          {error && <div className="auth-error">{error}</div>}

          <div className="form-row">
            <label className="form-label">
              Their first name
              <input type="text" value={ownerFirst} onChange={(e) => setOwnerFirst(e.target.value)} required className="form-input" />
            </label>
            <label className="form-label">
              Their last name
              <input type="text" value={ownerLast} onChange={(e) => setOwnerLast(e.target.value)} required className="form-input" />
            </label>
          </div>

          <label className="form-label">
            Your relationship to them
            <select value={ownerRelationship} onChange={(e) => setOwnerRelationship(e.target.value)} className="form-input" required>
              <option value="">Select...</option>
              <option value="daughter">Daughter</option>
              <option value="son">Son</option>
              <option value="spouse">Spouse</option>
              <option value="grandchild">Grandchild</option>
              <option value="niece_nephew">Niece/Nephew</option>
              <option value="friend">Friend</option>
              <option value="professional">Professional caregiver</option>
              <option value="other">Other</option>
            </select>
          </label>

          <button
            className="btn-primary-full"
            onClick={() => setStep('home')}
            disabled={!ownerFirst || !ownerLast || !ownerRelationship}
          >
            Continue to Home Profile
          </button>
        </div>
      </div>
    )
  }

  // Step: Home profile
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>
          {setupType === 'other'
            ? `Tell us about ${ownerFirst}'s home`
            : 'Tell us about your home'}
        </h1>
        <p className="auth-subtitle">
          This takes about 5 minutes. You can add more details later.
        </p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleComplete}>
          <label className="form-label">
            Street address
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} required className="form-input" placeholder="123 Main St" />
          </label>

          <div className="form-row form-row-3">
            <label className="form-label">
              City
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} required className="form-input" />
            </label>
            <label className="form-label">
              State
              <input type="text" value={state} onChange={(e) => setState(e.target.value)} required className="form-input" maxLength={2} />
            </label>
            <label className="form-label">
              Zip
              <input type="text" value={zip} onChange={(e) => setZip(e.target.value)} required className="form-input" maxLength={5} placeholder="80012" />
            </label>
          </div>

          <div className="form-row">
            <label className="form-label">
              Year built
              <input type="number" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} className="form-input" placeholder="1985" />
            </label>
            <label className="form-label">
              Square feet
              <input type="number" value={sqft} onChange={(e) => setSqft(e.target.value)} className="form-input" placeholder="2200" />
            </label>
          </div>

          <div className="form-row">
            <label className="form-label">
              Bedrooms
              <input type="number" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="form-input" />
            </label>
            <label className="form-label">
              Bathrooms
              <input type="number" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className="form-input" step="0.5" />
            </label>
          </div>

          <button type="submit" className="btn-primary-full" disabled={loading}>
            {loading ? 'Setting up your Home Circle...' : 'Create My Home Circle'}
          </button>
        </form>

        {setupType === 'other' && (
          <button className="btn-back" onClick={() => setStep('homeowner')}>
            ← Back
          </button>
        )}
      </div>
    </div>
  )
}
