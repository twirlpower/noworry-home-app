// Vercel serverless route: Stripe webhook receiver — Phase 3 (implemented).
//
// Verifies the Stripe-Signature header against STRIPE_WEBHOOK_SECRET, then
// reconciles family_circles billing state from the subscription lifecycle.
// Every processed event is recorded in stripe_webhook_events (migration 054)
// keyed by the Stripe event id — Stripe delivers at-least-once and retries on
// any non-2xx, so each event is idempotent: we skip anything already logged.
//
// Architecture note — why no checkout.session.completed handler:
//   This app does NOT use Stripe Checkout. Subscriptions are created in-app
//   via api/stripe/create-subscription.mjs (Stripe Elements + Subscriptions
//   API), which writes the initial billing state itself. So the "subscription
//   started" write happens inline at creation time, and this webhook only
//   handles the AFTER-THE-FACT drift that has no inline owner: renewals,
//   failed payments, trial→active transitions, and cancellations made in the
//   Stripe Dashboard. A checkout.session.completed event would never fire for
//   this integration, so handling it would be dead code.
//
// Column sync (family_circles) — the live UI (Settings, Dashboard, admin
// finance) reads all of these, so we keep them all current:
//   subscription_tier       — only changed to 'aware' on deletion; otherwise
//                             healed from the subscription's metadata.tier
//                             (NEVER hard-coded to 'prepared' — Covered/Complete
//                             circles also emit invoice.paid).
//   stripe_subscription_id  — cleared on deletion.
//   billing_status          — trial | active | past_due | unpaid | canceled
//   current_period_end      — refreshed from the subscription each event
//   trial_ends_at           — refreshed from subscription.trial_end
//   payment_method_brand/last4 — refreshed from the default payment method
//   billing_cycle           — healed from metadata.billing_cycle when present
//
// Body parsing: Stripe signature verification needs the RAW bytes, so the
// Vercel body parser is disabled and we read the stream ourselves.

import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'
import {
  downgradeSubject,
  downgradeHtml,
  paymentFailedSubject,
  paymentFailedHtml,
} from '../../src/lib/billingEmails.js'

export const config = {
  api: { bodyParser: false },
}

const STRIPE_API_VERSION = '2024-12-18.acacia'
const PAID_TIERS = new Set(['prepared', 'covered', 'complete'])

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

function isoFromUnix(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null
}

// Map a Stripe subscription.status to our billing_status vocabulary
// (migration 022). Returns null for transient states (incomplete, paused, …)
// so we never clobber a good value with a half-formed one.
function mapBillingStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'trialing':  return 'trial'
    case 'active':    return 'active'
    case 'past_due':  return 'past_due'
    case 'unpaid':    return 'unpaid'
    case 'canceled':  return 'canceled'
    default:          return null
  }
}

// Resolve the circle this event belongs to. Prefer the circle_id stamped in
// subscription metadata by create-subscription.mjs; fall back to the Stripe
// subscription / customer id stored on the row.
async function findCircle(admin, { circleId, subscriptionId, customerId }) {
  const cols = 'id, name, subscription_tier, billing_status, stripe_subscription_id, stripe_customer_id'
  if (circleId) {
    const { data } = await admin.from('family_circles').select(cols).eq('id', circleId).maybeSingle()
    if (data) return data
  }
  if (subscriptionId) {
    const { data } = await admin.from('family_circles').select(cols).eq('stripe_subscription_id', subscriptionId).maybeSingle()
    if (data) return data
  }
  if (customerId) {
    const { data } = await admin.from('family_circles').select(cols).eq('stripe_customer_id', customerId).maybeSingle()
    if (data) return data
  }
  return null
}

// Best-effort card brand/last4 from a subscription's default payment method.
// default_payment_method is an id (not expanded) on the lifecycle events, and
// is null during a no-card Path A trial — both are handled gracefully.
async function readCardDetails(stripe, defaultPaymentMethod) {
  const pmId = typeof defaultPaymentMethod === 'string'
    ? defaultPaymentMethod
    : defaultPaymentMethod?.id
  if (!pmId) return { brand: null, last4: null }
  try {
    const pm = await stripe.paymentMethods.retrieve(pmId)
    return { brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null }
  } catch (e) {
    console.warn('[stripe/webhook] payment_method_retrieve failed', e?.message)
    return { brand: null, last4: null }
  }
}

// Look up the circle_manager's first name + email via the two-query pattern
// (a join would silently fail under RLS — though we're on the service role
// here, we keep the same shape used everywhere else). Returns null when the
// circle has no active circle_manager or that person has no email on file.
async function getCircleManagerContact(admin, circleId) {
  const { data: mem } = await admin
    .from('circle_memberships')
    .select('person_id')
    .eq('circle_id', circleId)
    .eq('role', 'circle_manager')
    .eq('status', 'active')
    .limit(1)
  const personId = mem?.[0]?.person_id
  if (!personId) return null

  const { data: person } = await admin
    .from('persons')
    .select('first_name, email')
    .eq('id', personId)
    .maybeSingle()
  if (!person?.email) return null
  return person
}

// Best-effort transactional send. Mirrors the other stripe/*.mjs routes:
// requires RESEND_API_KEY + FROM_EMAIL, and a failure is logged but never
// fails the webhook (the DB state is already committed by the time we send).
async function sendBillingEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL || !to) return
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({ from: process.env.FROM_EMAIL, to, subject, html })
  } catch (e) {
    console.error('[stripe/webhook] billing email failed', e?.message)
  }
}

// ── per-event handlers ──────────────────────────────────────────────────────
// Each returns a short string describing what it did (for logs). They are
// deterministic "set to this value" writes, so re-running one is a no-op.

async function handleSubscriptionUpdated(admin, stripe, sub) {
  const circle = await findCircle(admin, {
    circleId: sub.metadata?.circle_id,
    subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
  })
  if (!circle) return 'no_matching_circle'

  const status = mapBillingStatus(sub.status)
  const { brand, last4 } = await readCardDetails(stripe, sub.default_payment_method)

  const patch = {
    current_period_end: isoFromUnix(sub.current_period_end),
    trial_ends_at: isoFromUnix(sub.trial_end),
  }
  if (status) patch.billing_status = status
  if (brand || last4) {
    patch.payment_method_brand = brand
    patch.payment_method_last4 = last4
  }
  if (sub.metadata?.billing_cycle === 'annual' || sub.metadata?.billing_cycle === 'monthly') {
    patch.billing_cycle = sub.metadata.billing_cycle
  }
  // Heal tier drift from metadata — but ONLY while the sub is live. A canceled
  // sub's downgrade is owned by the deleted handler; never resurrect a paid
  // tier here, and never hard-code 'prepared' (would clobber Covered/Complete).
  if (PAID_TIERS.has(sub.metadata?.tier) && status && status !== 'canceled') {
    patch.subscription_tier = sub.metadata.tier
  }

  const { error } = await admin.from('family_circles').update(patch).eq('id', circle.id)
  if (error) throw new Error(`db_update_failed: ${error.message}`)
  return `synced(status=${status ?? 'unchanged'})`
}

async function handleSubscriptionDeleted(admin, sub) {
  const circle = await findCircle(admin, {
    circleId: sub.metadata?.circle_id,
    subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
  })
  if (!circle) return 'no_matching_circle'

  // Terminal downgrade. Clear the subscription id (per spec) but keep
  // stripe_customer_id so a future re-subscribe reuses the customer.
  const { error } = await admin
    .from('family_circles')
    .update({
      subscription_tier: 'aware',
      billing_status: 'canceled',
      stripe_subscription_id: null,
    })
    .eq('id', circle.id)
  if (error) throw new Error(`db_update_failed: ${error.message}`)

  // Warm "you're on the free Aware plan" email to the circle_manager.
  // Best-effort: the downgrade is already committed above.
  const manager = await getCircleManagerContact(admin, circle.id)
  if (manager) {
    await sendBillingEmail({
      to: manager.email,
      subject: downgradeSubject(),
      html: downgradeHtml({ firstName: manager.first_name, circleName: circle.name }),
    })
  }
  return 'downgraded_to_aware'
}

async function handleInvoicePaid(admin, stripe, invoice) {
  const subId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id
  // One-off invoices (no subscription) aren't our concern.
  if (!subId) return 'no_subscription_on_invoice'

  const circle = await findCircle(admin, {
    subscriptionId: subId,
    customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
  })
  if (!circle) return 'no_matching_circle'

  // Pull the subscription for authoritative status/period/metadata.
  let sub = null
  try {
    sub = await stripe.subscriptions.retrieve(subId)
  } catch (e) {
    console.warn('[stripe/webhook] subscription_retrieve failed on invoice.paid', e?.message)
  }

  const status = sub ? mapBillingStatus(sub.status) : 'active'
  const patch = {}
  // Renewal succeeded → clear any past_due/unpaid. A paid invoice DURING a
  // trial keeps status 'trial' (mapBillingStatus handles that).
  if (status) patch.billing_status = status
  if (sub?.current_period_end) patch.current_period_end = isoFromUnix(sub.current_period_end)
  // Heal tier drift from metadata.tier — never force 'prepared'.
  if (sub && PAID_TIERS.has(sub.metadata?.tier) && status && status !== 'canceled') {
    patch.subscription_tier = sub.metadata.tier
  }

  if (Object.keys(patch).length === 0) return 'nothing_to_sync'
  const { error } = await admin.from('family_circles').update(patch).eq('id', circle.id)
  if (error) throw new Error(`db_update_failed: ${error.message}`)
  return `invoice_paid(status=${status ?? 'unchanged'})`
}

async function handleInvoicePaymentFailed(admin, invoice) {
  const subId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id
  if (!subId) return 'no_subscription_on_invoice'

  const circle = await findCircle(admin, {
    subscriptionId: subId,
    customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
  })
  if (!circle) return 'no_matching_circle'

  // Do NOT downgrade — Stripe retries per dunning settings. Just mark past_due
  // so the UI can prompt for a new card. The terminal downgrade (if dunning
  // gives up) arrives later as customer.subscription.deleted.
  const { error } = await admin
    .from('family_circles')
    .update({ billing_status: 'past_due' })
    .eq('id', circle.id)
  if (error) throw new Error(`db_update_failed: ${error.message}`)

  // Card-declined nudge to the circle_manager. Best-effort: past_due is
  // already committed, and Stripe keeps retrying regardless of this email.
  const manager = await getCircleManagerContact(admin, circle.id)
  if (manager) {
    await sendBillingEmail({
      to: manager.email,
      subject: paymentFailedSubject(),
      html: paymentFailedHtml({ firstName: manager.first_name, circleName: circle.name }),
    })
  }
  return 'marked_past_due'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'stripe_env_missing' })
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'supabase_env_missing' })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })

  let event
  try {
    const raw = await readRawBody(req)
    const sig = req.headers['stripe-signature']
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed', err?.message)
    return res.status(400).json({ error: 'invalid_signature' })
  }

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // ── Idempotency: skip anything already processed ──────────────────────────
  try {
    const { data: existing } = await admin
      .from('stripe_webhook_events')
      .select('id')
      .eq('stripe_event_id', event.id)
      .maybeSingle()
    if (existing) {
      return res.status(200).json({ received: true, duplicate: true })
    }
  } catch (e) {
    // A read failure here shouldn't drop the event — fall through and process.
    console.warn('[stripe/webhook] idempotency check failed', e?.message)
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  // Every branch (including default) assigns outcome before it's read below;
  // the catch returns early, so it's never read unassigned.
  let outcome
  try {
    const obj = event.data.object
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
        outcome = await handleSubscriptionUpdated(admin, stripe, obj)
        break
      case 'customer.subscription.deleted':
        outcome = await handleSubscriptionDeleted(admin, obj)
        break
      case 'invoice.paid':
        outcome = await handleInvoicePaid(admin, stripe, obj)
        break
      case 'invoice.payment_failed':
        outcome = await handleInvoicePaymentFailed(admin, obj)
        break
      default:
        outcome = 'unhandled_type'
    }
  } catch (err) {
    // A handler failure (almost always a transient DB error) must NOT be
    // logged as processed — return 500 so Stripe retries. The handlers are
    // idempotent deterministic writes, so a retry re-applies cleanly.
    // Surface the actual error (message + stack in logs, message in the
    // response) so the next Stripe resend shows the real cause — TEMPORARY
    // verbose diagnostics; tighten the response body back to a generic error
    // once the production 500 is identified.
    console.error('[stripe/webhook] 500 error:', err.message, err.stack)
    return res.status(500).json({ error: 'handler_failed', detail: err.message })
  }

  // ── Record as processed (idempotency + audit) ─────────────────────────────
  try {
    const { error: logErr } = await admin
      .from('stripe_webhook_events')
      .insert({
        stripe_event_id: event.id,
        event_type: event.type,
        payload: event,
      })
    // 23505 = unique_violation: a concurrent delivery already logged it. The
    // write above was idempotent, so this race is harmless.
    if (logErr && logErr.code !== '23505') {
      console.error('[stripe/webhook] event log insert failed', logErr.message)
    }
  } catch (e) {
    console.error('[stripe/webhook] event log insert threw', e?.message)
  }

  console.log('[stripe/webhook] processed', { id: event.id, type: event.type, outcome })
  return res.status(200).json({ received: true, handled: true, outcome })
}
