import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCircle } from '../context/CircleContext'

// Two-call confirmation modal for moving a circle from Prepared (trial OR
// active) to the free Aware plan. Wraps api/stripe/downgrade-to-aware.mjs
// — which does NOT call Stripe (use cancel-subscription for active subs
// to honor period-end semantics). For an active paid subscription, this
// modal is reused by the cancel flow via the same endpoint.
export default function DowngradeConfirmModal({
  open,
  onClose,
  onConfirmed,
  variant = 'aware', // 'aware' | 'cancel'
  periodEndIso = null,
}) {
  const { activeCircle, applyCircleUpdate } = useCircle()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const isCancel = variant === 'cancel'

  async function handleConfirm() {
    setError('')
    setSubmitting(true)

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) {
      setError('Your session has expired. Please sign in again.')
      setSubmitting(false)
      return
    }

    const endpoint = isCancel
      ? '/api/stripe/cancel-subscription'
      : '/api/stripe/downgrade-to-aware'

    let res
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ circleId: activeCircle.id }),
      })
    } catch {
      setError('Network problem — please try again.')
      setSubmitting(false)
      return
    }

    const payload = await res.json().catch(() => ({}))
    if (!res.ok || !payload.ok) {
      setError(payload.detail || 'Could not complete the change. Please try again.')
      setSubmitting(false)
      return
    }

    applyCircleUpdate(activeCircle.id, {
      ...(payload.subscription_tier ? { subscription_tier: payload.subscription_tier } : {}),
      ...(payload.billing_status ? { billing_status: payload.billing_status } : {}),
      ...(payload.current_period_end !== undefined ? { current_period_end: payload.current_period_end } : {}),
    })
    setSubmitting(false)
    onConfirmed?.()
    onClose?.()
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={isCancel ? 'Cancel subscription' : 'Switch to Aware'}>
      <div className="modal-shell modal-shell-narrow">
        <h2 className="payment-heading">
          {isCancel ? 'Cancel your Prepared plan?' : 'Switch to Aware plan?'}
        </h2>
        {isCancel ? (
          <p className="payment-subtext">
            You'll keep access until{' '}
            {periodEndIso
              ? new Date(periodEndIso).toLocaleDateString(undefined, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'the end of your current billing period'}
            . After that, your account switches to the free Aware plan.
          </p>
        ) : (
          <p className="payment-subtext">
            Your documents, emergency contacts, and tasks will be saved —
            but you won't be able to access them until you upgrade again.
          </p>
        )}

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button
          type="button"
          className="btn-primary-full"
          onClick={onClose}
          disabled={submitting}
        >
          {isCancel ? 'Keep my plan' : 'Cancel'}
        </button>
        <button
          type="button"
          className="btn-back btn-back-danger"
          onClick={handleConfirm}
          disabled={submitting}
        >
          {submitting
            ? 'Working…'
            : isCancel
              ? 'Cancel subscription'
              : 'Switch to Aware'}
        </button>
      </div>
    </div>
  )
}
