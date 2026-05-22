// Vercel serverless route: Stripe webhook receiver — STUBBED for Phase 3.
//
// What this does today:
//   - Verifies the Stripe-Signature header against STRIPE_WEBHOOK_SECRET
//     (so we don't accept spoofed payloads if the endpoint is ever exposed).
//   - Logs the event type and returns 200 so Stripe doesn't retry forever.
//   - Returns a clear "not implemented" for any event we receive — the
//     subscription state in family_circles will not be updated by this
//     route until Phase 3 wires the real handlers.
//
// Phase 3 — events to implement here (priority order):
//
//   customer.subscription.deleted
//     Sub fully ended (cancel_at_period_end completed, or admin-canceled in
//     Stripe Dashboard). Action: set family_circles.billing_status='canceled'
//     and subscription_tier='aware'. Send the same downgrade email as
//     api/stripe/downgrade-to-aware.mjs.
//
//   invoice.payment_failed
//     Renewal failed. Stripe will retry per dunning settings. Action: set
//     billing_status='past_due'. Send a "your card was declined" email.
//
//   invoice.paid
//     Renewal succeeded. Action: refresh current_period_end from the
//     invoice's parent subscription. If billing_status was 'past_due',
//     bump it back to 'active'.
//
// Lower priority (still worth handling):
//
//   customer.subscription.updated
//     Plan change, trial end transitions, etc. Re-sync current_period_end,
//     payment_method_brand/last4 if default_payment_method changed.
//
//   customer.deleted
//     If we ever delete a customer via the API (we don't today). Defensive.
//
// IMPORTANT — body parsing:
//   Stripe signature verification requires the RAW request body. Vercel's
//   default body parser turns the request into an already-parsed object,
//   which breaks signature verification. When implementing Phase 3:
//     export const config = { api: { bodyParser: false } }
//   ...and read the raw body via micro/raw-body or a stream reader before
//   passing to stripe.webhooks.constructEvent.

import Stripe from 'stripe'

export const config = {
  api: { bodyParser: false },
}

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'stripe_env_missing' })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })

  let event
  try {
    const raw = await readRawBody(req)
    const sig = req.headers['stripe-signature']
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed', err?.message)
    return res.status(400).json({ error: 'invalid_signature' })
  }

  // Phase 3 will handle these. For now we acknowledge so Stripe doesn't
  // retry — the events are not lost (visible in Stripe Dashboard) but
  // no DB write happens.
  console.log('[stripe/webhook] received event (not implemented)', {
    id: event.id,
    type: event.type,
  })

  return res.status(200).json({ received: true, handled: false })
}
