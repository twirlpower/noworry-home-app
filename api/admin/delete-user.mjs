// POST { userId, confirmEmail }
// Hard-deletes an auth account + the related persons row + circle
// memberships + any family_circles where this user is the billing
// person and no other home_owner / circle_manager is active.
//
// confirmEmail must match the auth user's email exactly — second-step
// safety guard.
//
// Caveats (v1):
//   * Operation is NOT atomic across schemas. We delete public-schema
//     rows first, then auth.users. If the auth delete fails after
//     public deletes succeed, you'll have a "ghost auth user" with no
//     persons row. Conversely if persons deletes succeed but circle
//     deletes fail, you may have orphan family_circles.
//   * Other tables that FK to persons (tasks, scheduled_maintenance,
//     documents, etc.) may keep references with a now-deleted person_id.
//     Whether those FKs have ON DELETE CASCADE depends on the schema;
//     this route does NOT pre-scrub them. If you see FK errors, those
//     references need cascade rules or explicit cleanup before
//     auth.deleteUser will work.
//
// Audit logged at every step.

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

  const { userId, confirmEmail } = req.body ?? {}
  if (!userId || !confirmEmail) {
    return res.status(400).json({ error: 'missing_fields' })
  }

  // Look up the auth user — make sure the confirm-email matches before
  // touching anything.
  const { data: authUserData, error: lookupErr } = await supabase.auth.admin.getUserById(userId)
  if (lookupErr || !authUserData?.user) {
    return res.status(404).json({ error: 'auth_user_not_found' })
  }
  const targetEmail = authUserData.user.email ?? ''
  if (targetEmail.toLowerCase().trim() !== String(confirmEmail).toLowerCase().trim()) {
    logAdminAction('delete-user.confirm_mismatch', {
      userId, staffUser: verify.user.id, expected: targetEmail, got: confirmEmail,
    })
    return res.status(400).json({ error: 'confirm_email_mismatch' })
  }

  logAdminAction('delete-user.start', {
    userId, email: targetEmail, staffUser: verify.user.id,
  })

  // Resolve the persons row (if any). The schema has persons.auth_id
  // UNIQUE but not ON DELETE CASCADE, so we clean up manually.
  const { data: personRow } = await supabase
    .from('persons')
    .select('id')
    .eq('auth_id', userId)
    .maybeSingle()
  const personId = personRow?.id ?? null

  // Find circles where this person is the billing owner AND the last
  // active home_owner / circle_manager. We archive those (rather than
  // hard-delete) to avoid orphaning historical billing data. If you
  // really want a hard delete, do it manually after the auth user is
  // gone.
  let archivedCircles = 0
  if (personId) {
    const { data: ownedCircles } = await supabase
      .from('family_circles')
      .select('id')
      .eq('billing_person_id', personId)
      .eq('is_archived', false)

    if (ownedCircles?.length) {
      for (const c of ownedCircles) {
        // Only archive if no OTHER active member is a home_owner/manager.
        const { count: othersCount } = await supabase
          .from('circle_memberships')
          .select('id', { count: 'exact', head: true })
          .eq('circle_id', c.id)
          .eq('status', 'active')
          .neq('person_id', personId)
          .in('role', ['home_owner', 'circle_manager'])
        if ((othersCount ?? 0) === 0) {
          const { error: arcErr } = await supabase
            .from('family_circles')
            .update({ is_archived: true, archived_at: new Date().toISOString() })
            .eq('id', c.id)
          if (!arcErr) archivedCircles += 1
        }
      }
    }

    // Wipe this person's circle_memberships (best-effort).
    await supabase.from('circle_memberships').delete().eq('person_id', personId)

    // Delete the persons row. If FK refs from other tables block this,
    // we surface the error — the auth user is NOT deleted in that case.
    const { error: pErr } = await supabase.from('persons').delete().eq('id', personId)
    if (pErr) {
      logAdminAction('delete-user.persons_delete_failed', {
        userId, personId, error: pErr.message,
      })
      return res.status(500).json({
        error: 'persons_delete_failed',
        detail: pErr.message,
        archivedCircles,
      })
    }
  }

  // Finally, drop the auth user.
  const { error: authErr } = await supabase.auth.admin.deleteUser(userId)
  if (authErr) {
    logAdminAction('delete-user.auth_delete_failed', {
      userId, personId, error: authErr.message,
    })
    return res.status(500).json({
      error: 'auth_delete_failed',
      detail: authErr.message,
      archivedCircles,
      personId, // for manual recovery if needed
    })
  }

  logAdminAction('delete-user.done', {
    userId, personId, archivedCircles, staffUser: verify.user.id,
  })
  return res.status(200).json({ ok: true, archivedCircles })
}
