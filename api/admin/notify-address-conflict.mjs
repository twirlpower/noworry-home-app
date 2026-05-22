// POST { address: {line1, city, state, zip}, existingHomeId }
//
// Called by Onboarding.jsx when a user tries to claim an address already
// bound to an active circle. Sends an admin-facing email to
// hello@noworry-home.com so the team can investigate (recent home sale,
// honest mistake, fraud, etc).
//
// Auth: any signed-in user. We pull the caller's persons row to include
// name+email in the notification — never trust client-supplied identity.
// Rate limiting is not enforced here; the cost of spam is low and the
// signal value is high.

import { Resend } from 'resend'
import { serviceClient } from './_staff-auth.mjs'

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabase = serviceClient()
  if (!supabase) return res.status(500).json({ error: 'supabase_env_missing' })

  // Verify the caller is signed in. Skip staff role check — this fires
  // for regular members during onboarding.
  const auth = req.headers?.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'unauthorized' })
  const { data: userData, error: uErr } = await supabase.auth.getUser(token)
  if (uErr || !userData?.user) return res.status(401).json({ error: 'unauthorized' })

  const { address, existingHomeId } = req.body ?? {}
  if (!address?.line1 || !address?.zip) {
    return res.status(400).json({ error: 'missing_address' })
  }

  // Resolve the caller's persons row for the notification body.
  const { data: person } = await supabase
    .from('persons')
    .select('first_name, last_name, email')
    .eq('auth_id', userData.user.id)
    .maybeSingle()
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(' ') || '(no name set)'
  const email = person?.email ?? userData.user.email ?? '(no email)'

  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
    // We've done the audit log work — just signal "no mail" cleanly.
    console.warn('[address-conflict] notification skipped: RESEND_API_KEY / FROM_EMAIL not configured', {
      attempted_by: { name, email }, address, existingHomeId,
    })
    return res.status(200).json({ ok: true, mailed: false })
  }

  const fullAddress = [
    address.line1,
    address.city,
    address.state,
    address.zip,
  ].filter(Boolean).join(', ')

  const html = `
    <h2 style="font-family: -apple-system, sans-serif; color: #0A4A30;">
      Address conflict — action may be needed
    </h2>
    <p style="font-family: -apple-system, sans-serif; color: #513C3C;">
      Someone attempted to claim an address that's already bound to an
      active home circle.
    </p>
    <table style="font-family: -apple-system, sans-serif; font-size: 14px; border-collapse: collapse;">
      <tr><td><strong>Person attempting:</strong></td><td>${escapeHtml(name)}</td></tr>
      <tr><td><strong>Email:</strong></td><td>${escapeHtml(email)}</td></tr>
      <tr><td><strong>Address:</strong></td><td>${escapeHtml(fullAddress)}</td></tr>
      <tr><td><strong>Existing home id:</strong></td><td><code>${escapeHtml(existingHomeId ?? 'unknown')}</code></td></tr>
      <tr><td><strong>When:</strong></td><td>${escapeHtml(new Date().toISOString())}</td></tr>
    </table>
    <p style="font-family: -apple-system, sans-serif;">
      <a href="https://app.noworry-home.com/admin/crm">Open Admin CRM → Customers</a>
    </p>
  `

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: 'hello@noworry-home.com',
      subject: 'Address conflict — action may be needed',
      html,
    })
    console.log('[ADMIN ACTION] address-conflict.notified', {
      attempted_by: email, address: fullAddress, existingHomeId,
    })
    return res.status(200).json({ ok: true, mailed: true })
  } catch (e) {
    console.error('[address-conflict] resend send failed', e?.message)
    return res.status(500).json({ error: 'send_failed', detail: e?.message })
  }
}
