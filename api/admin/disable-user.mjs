// POST { userId }
// Bans an auth user for ~100 years. They can't log in; their data
// (persons, family_circles, etc.) stays intact so an admin can re-enable
// later by clearing the ban.

import { serviceClient, verifyStaff, logAdminAction } from './_staff-auth.mjs'

const BAN_DURATION = '876600h' // 100 years

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabase = serviceClient()
  if (!supabase) return res.status(500).json({ error: 'supabase_env_missing' })

  const verify = await verifyStaff(req, supabase, ['owner', 'staff'])
  if (!verify.ok) return res.status(verify.status).json(verify.body)

  const { userId } = req.body ?? {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'missing_user_id' })
  }

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: BAN_DURATION,
  })

  if (error) {
    logAdminAction('disable-user.failed', { userId, staffUser: verify.user.id, error: error.message })
    return res.status(500).json({ error: error.message })
  }

  logAdminAction('disable-user.banned', { userId, staffUser: verify.user.id })
  return res.status(200).json({ ok: true })
}
