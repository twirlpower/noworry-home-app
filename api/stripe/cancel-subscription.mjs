// Vercel serverless route: cancel a Stripe subscription at period end.
//
// The subscription stays active until current_period_end (the user keeps
// access to Prepared features through what they've paid for), then Stripe
// will cancel it. Without webhooks we won't get notified — the next time
// the user touches a flow that checks billing_status, we trust our DB.
//
// "Downgrade to Aware" (no Stripe subscription, just flipping the tier)
// is handled by api/stripe/downgrade-to-aware.mjs.

import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const BILLING_ROLES = new Set(['home_owner', 'circle_manager', 'care_partner', 'care_coordinator'])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'supabase_env_missing' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'stripe_env_missing' })
  }

  const { circleId } = req.body ?? {}
  if (!circleId) return res.status(400).json({ error: 'missing_fields' })

  const auth = req.headers?.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'unauthorized' })

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'unauthorized' })
  const authId = userData.user.id

  const { data: person, error: personErr } = await admin
    .from('persons')
    .select('id')
    .eq('auth_id', authId)
    .maybeSingle()
  if (personErr || !person) return res.status(403).json({ error: 'forbidden' })

  const { data: membership } = await admin
    .from('circle_memberships')
    .select('role')
    .eq('person_id', person.id)
    .eq('circle_id', circleId)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership || !BILLING_ROLES.has(membership.role)) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const { data: circle } = await admin
    .from('family_circles')
    .select('id, stripe_subscription_id, billing_status')
    .eq('id', circleId)
    .maybeSingle()
  if (!circle) return res.status(404).json({ error: 'circle_not_found' })

  if (!circle.stripe_subscription_id) {
    return res.status(400).json({ error: 'no_active_subscription' })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })

  try {
    const updated = await stripe.subscriptions.update(circle.stripe_subscription_id, {
      cancel_at_period_end: true,
    })

    // Stamp billing_status='canceled' immediately so the UI shows the
    // pending cancellation. subscription_tier stays 'prepared' until the
    // period actually ends — the user keeps access to what they paid for.
    const periodEndIso = updated.current_period_end
      ? new Date(updated.current_period_end * 1000).toISOString()
      : null

    const { error: updErr } = await admin
      .from('family_circles')
      .update({
        billing_status: 'canceled',
        current_period_end: periodEndIso,
      })
      .eq('id', circle.id)
    if (updErr) {
      console.error('[stripe/cancel-subscription] DB update failed after stripe success', updErr)
      return res.status(500).json({ error: 'db_update_failed_after_stripe_success' })
    }

    return res.status(200).json({
      ok: true,
      billing_status: 'canceled',
      current_period_end: periodEndIso,
    })
  } catch (e) {
    console.error('[stripe/cancel-subscription] stripe error', e?.type, e?.message)
    return res.status(502).json({ error: 'stripe_error', detail: e?.message ?? 'Cancel failed.' })
  }
}
