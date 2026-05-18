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

    try {
      // 1. Create the home
      const { data: home, error: homeError } = await supabase
        .from('homes')
        .insert({
          address_line1: address,
          city,
          state,
          zip,
          year_built: yearBuilt ? parseInt(yearBuilt) : null,
          square_feet: sqft ? parseInt(sqft) : null,
          bedrooms: bedrooms ? parseInt(bedrooms) : null,
          bathrooms: bathrooms ? parseFloat(bathrooms) : null,
        })
        .select()
        .single()

      if (homeError) throw homeError

      // 2. Create proxy Home Owner if setting up for someone else
      let homeOwnerId = person.id
      if (setupType === 'other') {
        const { data: owner, error: ownerError } = await supabase
          .from('persons')
          .insert({
            first_name: ownerFirst,
            last_name: ownerLast,
            auth_status: 'proxy',
            created_by: person.id,
          })
          .select()
          .single()

        if (ownerError) throw ownerError
        homeOwnerId = owner.id
      }

      // 3. Create the family circle
      const circleName = setupType === 'other'
        ? `${ownerFirst}'s Home Circle`
        : `${person.first_name}'s Home Circle`

      const { data: circle, error: circleError } = await supabase
        .from('family_circles')
        .insert({
          name: circleName,
          subscription_tier: 'home_base',
        })
        .select()
        .single()

      if (circleError) throw circleError

      // 4. Add the home to the circle
      await supabase.from('circle_homes').insert({
        circle_id: circle.id,
        home_id: home.id,
        is_primary: true,
      })

      // 5. Add memberships
      if (setupType === 'self') {
        // Self: person is Home Owner + Circle Manager
        await supabase.from('circle_memberships').insert({
          person_id: person.id,
          circle_id: circle.id,
          role: 'home_owner',
          status: 'active',
          joined_at: new Date().toISOString(),
        })
      } else {
        // Other: proxy is Home Owner, person is Circle Manager + Care Partner
        await supabase.from('circle_memberships').insert({
          person_id: homeOwnerId,
          circle_id: circle.id,
          role: 'home_owner',
          status: 'active',
          relationship: 'homeowner',
          joined_at: new Date().toISOString(),
        })
        await supabase.from('circle_memberships').insert({
          person_id: person.id,
          circle_id: circle.id,
          role: 'circle_manager',
          status: 'active',
          relationship: ownerRelationship,
          invited_by: person.id,
          joined_at: new Date().toISOString(),
        })
      }

      // 6. Reload circles and navigate to dashboard
      await reloadCircles()
      navigate('/dashboard')

    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
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
