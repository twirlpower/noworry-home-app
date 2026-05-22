// Vercel serverless route: downgrade a circle to the free Aware plan.
//
// This is the "Continue with free Aware plan" path on the trial-expired
// interstitial AND the post-cancel terminal state. No active subscription
// is required — if one exists, it's a no-op on Stripe (use cancel for that).
//
// Effect:
//   subscription_tier = 'aware'
//   billing_status = 'canceled'
// Data (documents, contacts, tasks) is preserved — RLS based on tier is
// applied at read time, but the rows themselves are kept.
//
// Sends a warm "we'll be here" email best-effort.

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import {
  downgradeSubject,
  downgradeHtml,
} from '../../src/lib/billingEmails.js'

const BILLING_ROLES = new Set(['home_owner', 'circle_manager', 'care_partner', 'care_coordinator'])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'supabase_env_missing' })
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

  const { data: person } = await admin
    .from('persons')
    .select('id, first_name, email')
    .eq('auth_id', userData.user.id)
    .maybeSingle()
  if (!person) return res.status(403).json({ error: 'forbidden' })

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
    .select('id, name')
    .eq('id', circleId)
    .maybeSingle()
  if (!circle) return res.status(404).json({ error: 'circle_not_found' })

  const { error: updErr } = await admin
    .from('family_circles')
    .update({
      subscription_tier: 'aware',
      billing_status: 'canceled',
    })
    .eq('id', circle.id)
  if (updErr) {
    console.error('[stripe/downgrade-to-aware] DB update failed', updErr)
    return res.status(500).json({ error: 'db_update_failed' })
  }

  // Best-effort email — failure does not roll back the downgrade.
  if (process.env.RESEND_API_KEY && process.env.FROM_EMAIL) {
    const recipient = person.email ?? userData.user.email
    if (recipient) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: recipient,
          subject: downgradeSubject(),
          html: downgradeHtml({
            firstName: person.first_name,
            circleName: circle.name,
          }),
        })
      } catch (e) {
        console.error('[stripe/downgrade-to-aware] email failed', e?.message)
      }
    }
  }

  return res.status(200).json({
    ok: true,
    subscription_tier: 'aware',
    billing_status: 'canceled',
  })
}
