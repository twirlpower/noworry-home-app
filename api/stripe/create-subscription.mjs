// Vercel serverless route: create a Stripe Subscription for a circle.
//
// Flow:
//   1. Verify the caller's Supabase JWT.
//   2. Resolve their persons row + active membership for the target circle.
//   3. Enforce role: only Family-write may start billing on a circle.
//   4. Stripe ops (with secret key, server-only):
//        - reuse stripe_customer_id if the circle already has one
//        - otherwise create a Customer
//        - attach + default the PaymentMethod the client just minted
//        - create the Subscription on STRIPE_PRICE_PREPARED
//   5. Update family_circles with the new billing fields.
//   6. Send a confirmation email via Resend (best-effort; failure logged
//      but does not roll back the subscription — the payment succeeded).
//
// Idempotency: if family_circles.stripe_subscription_id is already set
// (active or past_due), we treat the request as a no-op and return the
// existing state. This protects against a double-tap on the submit button.
//
// Phase 3 will add webhook handling. Without it, subscription state in our
// DB can drift from Stripe (cancellations done in Stripe Dashboard,
// failed renewals, etc.). The DB row reflects the LAST event we processed,
// not necessarily reality.

import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'
import {
  paymentConfirmationSubject,
  paymentConfirmationHtml,
} from '../../src/lib/billingEmails.js'

const BILLING_ROLES = new Set(['home_owner', 'circle_manager', 'care_partner', 'care_coordinator'])

// Formats a Stripe coupon into a single short display string. Prefers the
// coupon's own metadata.description so admins can write custom copy
// ("Family & friends — 20% forever"), but falls back to a generated
// summary if no metadata is set.
function formatDiscount(coupon) {
  if (coupon?.percent_off) {
    const suffix =
      coupon.duration === 'repeating'
        ? ` for ${coupon.duration_in_months} months`
        : coupon.duration === 'forever'
          ? ' forever'
          : ' first payment'
    return `${coupon.percent_off}% off${suffix}`
  }
  if (coupon?.amount_off) {
    return `$${(coupon.amount_off / 100).toFixed(2)} off`
  }
  return 'Discount applied'
}

function badRequest(res, code, detail) {
  return res.status(400).json({ error: code, ...(detail ? { detail } : {}) })
}

function unauthorized(res) {
  return res.status(401).json({ error: 'unauthorized' })
}

function forbidden(res) {
  return res.status(403).json({ error: 'forbidden' })
}

function serverError(res, code, detail) {
  console.error(`[stripe/create-subscription] ${code}:`, detail)
  return res.status(500).json({ error: code, ...(detail?.message ? { detail: detail.message } : {}) })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // Required server env
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return serverError(res, 'supabase_env_missing')
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_PREPARED) {
    return serverError(res, 'stripe_env_missing')
  }

  const body = req.body ?? {}
  const { paymentMethodId, circleId, promoCode: rawPromo } = body
  if (!paymentMethodId || !circleId) {
    return badRequest(res, 'missing_fields', 'paymentMethodId and circleId are required')
  }
  // Normalize: uppercase + strip whitespace so the lookup matches whatever
  // the admin entered in the Stripe Dashboard, and an empty string is
  // treated as "no code".
  const promoCode = typeof rawPromo === 'string' && rawPromo.trim()
    ? rawPromo.trim().toUpperCase()
    : null

  // ── Auth: verify the Supabase JWT and pull the acting person ─────────────
  const auth = req.headers?.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return unauthorized(res)

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return unauthorized(res)
  const authId = userData.user.id

  const { data: person, error: personErr } = await admin
    .from('persons')
    .select('id, first_name, email, auth_id')
    .eq('auth_id', authId)
    .maybeSingle()
  if (personErr || !person) return forbidden(res)

  const { data: membership, error: memErr } = await admin
    .from('circle_memberships')
    .select('role')
    .eq('person_id', person.id)
    .eq('circle_id', circleId)
    .eq('status', 'active')
    .maybeSingle()
  if (memErr || !membership || !BILLING_ROLES.has(membership.role)) {
    return forbidden(res)
  }

  // ── Load the circle (and its existing Stripe state, if any) ──────────────
  const { data: circle, error: circleErr } = await admin
    .from('family_circles')
    .select('id, name, stripe_customer_id, stripe_subscription_id, billing_status')
    .eq('id', circleId)
    .maybeSingle()
  if (circleErr || !circle) return serverError(res, 'circle_not_found')

  // Idempotency: a circle already on an active subscription returns the
  // current state without touching Stripe.
  if (
    circle.stripe_subscription_id &&
    (circle.billing_status === 'active' || circle.billing_status === 'past_due')
  ) {
    return res.status(200).json({
      ok: true,
      already_subscribed: true,
      billing_status: circle.billing_status,
    })
  }

  // ── Stripe ops ───────────────────────────────────────────────────────────
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })

  // Validate the promo code first. Doing this BEFORE any customer/payment-
  // method work means an invalid code fails fast with no Stripe-side
  // side effects to clean up.
  let validatedCoupon = null
  if (promoCode) {
    try {
      const c = await stripe.coupons.retrieve(promoCode)
      // A coupon can be retrieved while inactive (deleted=true or valid=false).
      // Reject those — only currently-redeemable codes count.
      if (!c?.valid) {
        return res.status(400).json({ error: 'Invalid promo code' })
      }
      validatedCoupon = c
    } catch (e) {
      // Stripe returns 404 / resource_missing for an unknown coupon id.
      console.warn('[stripe/create-subscription] coupon lookup failed', e?.code, e?.message)
      return res.status(400).json({ error: 'Invalid promo code' })
    }
  }

  let customerId = circle.stripe_customer_id
  try {
    if (!customerId) {
      const recipient = person.email ?? userData.user.email
      const customer = await stripe.customers.create({
        email: recipient ?? undefined,
        name: circle.name ?? undefined,
        metadata: { circle_id: circle.id, person_id: person.id },
      })
      customerId = customer.id
    }

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })

    // Use the newer `discounts` array shape rather than the deprecated
    // `coupon` top-level parameter on subscriptions.create.
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: process.env.STRIPE_PRICE_PREPARED }],
      default_payment_method: paymentMethodId,
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        circle_id: circle.id,
        ...(validatedCoupon ? { promo_code: validatedCoupon.id } : {}),
      },
      ...(validatedCoupon ? { discounts: [{ coupon: validatedCoupon.id }] } : {}),
    })

    // Pull card details for display ("Visa ending in 4242"). PaymentMethod
    // is freshly attached, so a re-fetch is the cleanest way to get the
    // surfaced card brand/last4 without parsing the attach response.
    let last4 = null
    let brand = null
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId)
      last4 = pm.card?.last4 ?? null
      brand = pm.card?.brand ?? null
    } catch (e) {
      console.warn('[stripe/create-subscription] payment_method_retrieve failed', e?.message)
    }

    const periodEndIso = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null

    // subscription_tier flip handles the Aware → Prepared upgrade path too;
    // an in-trial circle is already on 'prepared' so the SET is a no-op for
    // that case.
    const { error: updErr } = await admin
      .from('family_circles')
      .update({
        subscription_tier: 'prepared',
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        billing_status: 'active',
        payment_method_last4: last4,
        payment_method_brand: brand,
        current_period_end: periodEndIso,
      })
      .eq('id', circle.id)
    if (updErr) {
      // Stripe charged but DB write failed. Surface loudly — manual recovery
      // (read sub from Stripe Dashboard, paste into the row). Phase 3
      // webhooks will reconcile this automatically.
      console.error('[stripe/create-subscription] CRITICAL: stripe success but DB update failed', {
        circleId: circle.id,
        subscriptionId: subscription.id,
        error: updErr.message,
      })
      return res.status(500).json({
        error: 'db_update_failed_after_stripe_success',
        detail: 'Payment succeeded but the local record could not be updated. Contact support.',
        stripe_subscription_id: subscription.id,
      })
    }

    // ── Best-effort confirmation email ─────────────────────────────────────
    if (process.env.RESEND_API_KEY && process.env.FROM_EMAIL) {
      const recipient = person.email ?? userData.user.email
      if (recipient) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        try {
          await resend.emails.send({
            from: process.env.FROM_EMAIL,
            to: recipient,
            subject: paymentConfirmationSubject(),
            html: paymentConfirmationHtml({
              firstName: person.first_name,
              circleName: circle.name,
              cardBrand: brand,
              cardLast4: last4,
              periodEndIso,
            }),
          })
        } catch (e) {
          // Email failure does not roll back. Log and move on.
          console.error('[stripe/create-subscription] confirmation email failed', e?.message)
        }
      }
    }

    return res.status(200).json({
      ok: true,
      stripe_subscription_id: subscription.id,
      billing_status: 'active',
      payment_method_last4: last4,
      payment_method_brand: brand,
      current_period_end: periodEndIso,
      coupon: validatedCoupon
        ? {
            id: validatedCoupon.id,
            name: validatedCoupon.name || validatedCoupon.id,
            description:
              validatedCoupon.metadata?.description || formatDiscount(validatedCoupon),
          }
        : null,
    })
  } catch (e) {
    // Stripe surfaces user-friendly messages on e.message (card declined,
    // etc.). Propagate so the client can show it.
    console.error('[stripe/create-subscription] stripe error', e?.type, e?.message)
    return res.status(402).json({
      error: 'stripe_error',
      detail: e?.message ?? 'Payment processing failed.',
      code: e?.code ?? null,
    })
  }
}
