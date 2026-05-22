// POST { email }
// Triggers a Supabase password-reset email for the target user. Uses the
// service-role client only for the staff-auth check; the actual
// resetPasswordForEmail call uses the same public auth path the
// /forgot-password page uses, so the email template + redirect URLs
// configured in the Supabase Dashboard are honored.

import { serviceClient, verifyStaff, logAdminAction } from './_staff-auth.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabase = serviceClient()
  if (!supabase) return res.status(500).json({ error: 'supabase_env_missing' })

  const verify = await verifyStaff(req, supabase, ['owner', 'staff'])
  if (!verify.ok) return res.status(verify.status).json(verify.body)

  const { email } = req.body ?? {}
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'missing_email' })
  }

  // resetPasswordForEmail is the same endpoint the public /forgot-password
  // flow uses — Supabase Auth handles the email + token lifecycle. The
  // redirect URL matches the AuthContext.resetPassword behavior.
  const appUrl = process.env.VITE_APP_URL || 'https://app.noworry-home.com'
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/reset-password`,
  })

  if (error) {
    logAdminAction('reset-password.failed', { email, staffUser: verify.user.id, error: error.message })
    return res.status(400).json({ error: error.message })
  }

  logAdminAction('reset-password.sent', { email, staffUser: verify.user.id })
  return res.status(200).json({ ok: true })
}
