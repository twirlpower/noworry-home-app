// Shared helpers for the api/admin/* routes.
//
// verifyStaff() takes the request + a service-role supabase client and
// returns { ok: true, user, person, role } if the caller is an active
// staff account with a role in `allowedRoles`. Otherwise returns
// { ok: false, status, body } shaped to send straight to res.

import { createClient } from '@supabase/supabase-js'

export function serviceClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function verifyStaff(req, supabase, allowedRoles = ['owner', 'staff']) {
  const auth = req.headers?.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return { ok: false, status: 401, body: { error: 'unauthorized' } }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, body: { error: 'unauthorized' } }
  }

  const { data: staffRow } = await supabase
    .from('staff_accounts')
    .select('role, active')
    .eq('user_id', userData.user.id)
    .eq('active', true)
    .maybeSingle()

  if (!staffRow || !allowedRoles.includes(staffRow.role)) {
    return { ok: false, status: 403, body: { error: 'forbidden' } }
  }

  return { ok: true, user: userData.user, role: staffRow.role }
}

// Audit log line. Cheap and useful — Vercel captures stdout per invocation,
// and any centralized log aggregator can grep [ADMIN ACTION].
export function logAdminAction(action, ctx) {
  console.log('[ADMIN ACTION]', action, JSON.stringify(ctx))
}
