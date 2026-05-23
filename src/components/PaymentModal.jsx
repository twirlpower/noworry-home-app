import { useMemo, useState } from 'react'
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

// Pricing matrix — keyed by `${tier}_${propertyTier}` then by cycle.
// Numbers are display-only; the server picks the actual Stripe price
// ID from env vars. Keeping the table here lets PaymentModal show
// accurate copy without an extra round-trip on open.
const PRICING = {
  prepared_standard: {
    label: 'Prepared',
    monthly: { amount: 12, label: '$12 / month' },
    // No annual option for Prepared — toggle is suppressed.
    annual: null,
  },
  covered_standard: {
    label: 'Covered',
    monthly: { amount: 99, label: '$99 / month' },
    annual: {
      amount: 1068,
      label: '$1,068 / year',
      perMonthLabel: "That's $89/mo — save $120 vs monthly",
    },
  },
  covered_enhanced: {
    label: 'Covered',
    monthly: { amount: 129, label: '$129 / month' },
    annual: {
      amount: 1392,
      label: '$1,392 / year',
      perMonthLabel: "That's $116/mo — save vs monthly",
    },
  },
  complete_standard: {
    label: 'Complete',
    monthly: { amount: 179, label: '$179 / month' },
    annual: {
      amount: 2148,
      label: '$2,148 / year',
      perMonthLabel: "That's $179/mo average — save vs monthly",
    },
  },
  complete_enhanced: {
    label: 'Complete',
    monthly: { amount: 219, label: '$219 / month' },
    annual: {
      amount: 2628,
      label: '$2,628 / year',
      perMonthLabel: "That's $219/mo average — save vs monthly",
    },
  },
}

function formatNextBillingDate() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

function PaymentForm({ onSuccess, onCancel, tier = 'prepared', propertyTier = 'standard' }) {
  const stripe = useStripe()
  const elements = useElements()
  const { activeCircle, applyCircleUpdate } = useCircle()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [promoApplied, setPromoApplied] = useState(null)
  const [promoError, setPromoError] = useState('')

  const pricingKey = `${tier}_${propertyTier}`
  const product = PRICING[pricingKey] ?? PRICING.prepared_standard
  const annualSupported = !!product.annual

  // Annual is the default when offered. Prepared doesn't have annual,
  // so the toggle never shows for it and the cycle stays 'monthly'.
  const [billingCycle, setBillingCycle] = useState(annualSupported ? 'annual' : 'monthly')

  const activeRate = useMemo(
    () => (billingCycle === 'annual' ? product.annual : product.monthly),
    [billingCycle, product]
  )

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setError('')
    setPromoError('')
    setPromoApplied(null)
    setSubmitting(true)

    const card = elements.getElement(CardElement)
    const pmResult = await stripe.createPaymentMethod({ type: 'card', card })
    if (pmResult.error) {
      setError(pmResult.error.message || 'Could not read card details.')
      setSubmitting(false)
      return
    }

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
          tier,
          billingCycle,
          ...(promoCode ? { promoCode } : {}),
        }),
      })
    } catch {
      setError('Network problem — please try again.')
      setSubmitting(false)
      return
    }

    const payload = await res.json().catch(() => ({}))
    if (!res.ok || !payload.ok) {
      if (payload.error === 'Invalid promo code') {
        setPromoError("That code isn't valid. Check the spelling and try again.")
      } else {
        setError(payload.detail || 'Payment processing failed. Please try again.')
      }
      setSubmitting(false)
      return
    }

    // Server may have silently fallen back to monthly if the annual price
    // env isn't set — trust whatever it returns for billing_cycle.
    applyCircleUpdate(activeCircle.id, {
      subscription_tier: payload.subscription_tier ?? tier,
      billing_status: payload.billing_status ?? 'active',
      billing_cycle: payload.billing_cycle ?? billingCycle,
      trial_days: payload.trial_days ?? null,
      stripe_subscription_id: payload.stripe_subscription_id ?? null,
      payment_method_brand: payload.payment_method_brand ?? null,
      payment_method_last4: payload.payment_method_last4 ?? null,
      current_period_end: payload.current_period_end ?? null,
    })
    setSubmitting(false)

    if (payload.coupon) {
      setPromoApplied(payload.coupon)
      setTimeout(() => onSuccess?.(), 1500)
    } else {
      onSuccess?.()
    }
  }

  const ctaSuffix = billingCycle === 'annual'
    ? `${product.label} — ${product.annual.label}`
    : `${product.label} — ${product.monthly.label}`

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <h2 className="payment-heading">Add your payment method</h2>
      <p className="payment-subtext">
        Secure payment powered by Stripe. We never store your card details.
      </p>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {annualSupported && (
        <div className="billing-cycle-toggle" role="radiogroup" aria-label="Billing cycle">
          <button
            type="button"
            role="radio"
            aria-checked={billingCycle === 'annual'}
            className={`billing-cycle-pill ${billingCycle === 'annual' ? 'on' : ''}`}
            onClick={() => setBillingCycle('annual')}
          >
            <span className="billing-cycle-name">Annual</span>
            <span className="billing-cycle-badge">2 months free ✓</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={billingCycle === 'monthly'}
            className={`billing-cycle-pill ${billingCycle === 'monthly' ? 'on' : ''}`}
            onClick={() => setBillingCycle('monthly')}
          >
            <span className="billing-cycle-name">Monthly</span>
          </button>
        </div>
      )}

      <div className="billing-cycle-price">
        <strong>{activeRate.label}</strong>
        {billingCycle === 'annual' && product.annual?.perMonthLabel && (
          <span className="billing-cycle-permo">{product.annual.perMonthLabel}</span>
        )}
      </div>

      <div className="payment-card-field">
        <CardElement options={CARD_OPTIONS} />
      </div>

      <div className="promo-code-row">
        <input
          type="text"
          className="promo-code-input"
          placeholder="Promo code (optional)"
          value={promoCode}
          onChange={(e) => {
            setPromoCode(e.target.value.toUpperCase().trim())
            if (promoError) setPromoError('')
          }}
          disabled={submitting}
          autoComplete="off"
        />
        {promoApplied && (
          <span className="promo-success">
            ✓ {promoApplied.name} applied — {promoApplied.description}
          </span>
        )}
        {promoError && (
          <span className="promo-error">{promoError}</span>
        )}
      </div>

      <button
        type="submit"
        className="btn-primary-full"
        disabled={!stripe || submitting}
      >
        {submitting ? 'Processing…' : `Start ${ctaSuffix}`}
      </button>

      <p className="payment-fine">
        {billingCycle === 'annual'
          ? `You'll be charged ${product.annual.label} on ${formatNextBillingDate()}. Cancel anytime from Settings.`
          : `You'll be charged $${product.monthly.amount} on ${formatNextBillingDate()}. Cancel anytime from Settings.`
        }
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

export default function PaymentModal({ open, onClose, onSuccess, tier, propertyTier }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add payment method">
      <div className="modal-shell">
        <Elements stripe={stripePromise}>
          <PaymentForm
            tier={tier}
            propertyTier={propertyTier}
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
