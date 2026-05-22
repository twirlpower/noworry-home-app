import { useState } from 'react'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { stripePromise } from '../lib/stripe'
import { supabase } from '../lib/supabase'
import { useCircle } from '../context/CircleContext'

// Card element styling — senior-friendly: larger font, generous padding,
// brand colors matched to the rest of the app.
const CARD_OPTIONS = {
  style: {
    base: {
      fontSize: '16px',
      color: '#513C3C',
      fontFamily: "'Source Sans 3', 'Source Sans Pro', -apple-system, sans-serif",
      '::placeholder': { color: '#B89C8C' },
    },
    invalid: { color: '#B23A16' },
  },
}

function formatNextBillingDate() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

function PaymentForm({ onSuccess, onCancel }) {
  const stripe = useStripe()
  const elements = useElements()
  const { activeCircle, applyCircleUpdate } = useCircle()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setError('')
    setSubmitting(true)

    // Step 1: collect the card and mint a PaymentMethod token. The card
    // details never touch our server — Stripe.js sends them directly.
    const card = elements.getElement(CardElement)
    const pmResult = await stripe.createPaymentMethod({ type: 'card', card })
    if (pmResult.error) {
      setError(pmResult.error.message || 'Could not read card details.')
      setSubmitting(false)
      return
    }

    // Step 2: POST to our serverless route, which uses the secret key to
    // create the Customer + Subscription server-side and update Supabase.
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) {
      setError('Your session has expired. Please sign in again.')
      setSubmitting(false)
      return
    }

    let res
    try {
      res = await fetch('/api/stripe/create-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          paymentMethodId: pmResult.paymentMethod.id,
          circleId: activeCircle.id,
        }),
      })
    } catch {
      setError('Network problem — please try again.')
      setSubmitting(false)
      return
    }

    const payload = await res.json().catch(() => ({}))
    if (!res.ok || !payload.ok) {
      setError(payload.detail || 'Payment processing failed. Please try again.')
      setSubmitting(false)
      return
    }

    // Patch the local circle cache so the UI reflects the new state without
    // a page reload. Same pattern as Dashboard.handleStartTrial. The server
    // sets subscription_tier='prepared' for both the trial-paying and the
    // aware-upgrading paths, so mirror that here.
    applyCircleUpdate(activeCircle.id, {
      subscription_tier: 'prepared',
      billing_status: payload.billing_status ?? 'active',
      stripe_subscription_id: payload.stripe_subscription_id ?? null,
      payment_method_brand: payload.payment_method_brand ?? null,
      payment_method_last4: payload.payment_method_last4 ?? null,
      current_period_end: payload.current_period_end ?? null,
    })
    setSubmitting(false)
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <h2 className="payment-heading">Add your payment method</h2>
      <p className="payment-subtext">
        Secure payment powered by Stripe. We never store your card details.
      </p>

      {error && <div className="auth-error" role="alert">{error}</div>}

      <div className="payment-card-field">
        <CardElement options={CARD_OPTIONS} />
      </div>

      <button
        type="submit"
        className="btn-primary-full"
        disabled={!stripe || submitting}
      >
        {submitting ? 'Processing…' : 'Start Prepared — $12/mo'}
      </button>

      <p className="payment-fine">
        You'll be charged $12 on {formatNextBillingDate()}. Cancel anytime from Settings.
      </p>

      <button
        type="button"
        className="btn-back"
        onClick={onCancel}
        disabled={submitting}
      >
        Cancel
      </button>
    </form>
  )
}

export default function PaymentModal({ open, onClose, onSuccess }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add payment method">
      <div className="modal-shell">
        <Elements stripe={stripePromise}>
          <PaymentForm
            onCancel={onClose}
            onSuccess={() => {
              onSuccess?.()
              onClose?.()
            }}
          />
        </Elements>
      </div>
    </div>
  )
}
