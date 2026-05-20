// Vercel Cron entry — runs daily per vercel.json. For each circle whose
// Prepared trial is still inside its 30-day window, sends any due drip
// emails (day_1 / day_7 / day_14 / day_28) and stamps them into the
// family_circles.trial_emails_sent jsonb so we don't re-send.
//
// Auth: Vercel Cron requests carry `Authorization: Bearer <CRON_SECRET>`.
// Reject anything that doesn't match — that's the only protection against
// a public POST to this endpoint draining the email quota.

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import {
  dueEmailKeys,
  subjectFor,
  htmlFor,
} from '../../src/lib/trialEmails.js'

// Pick a recipient from the Family-write roles, preferring whoever's most
// likely to have logged in to start the trial. home_owner can be a proxy
// (auth_status='proxy', no email), so circle_manager wins ties.
const ROLE_PRIORITY = { circle_manager: 1, home_owner: 2, care_partner: 3 }

export default async function handler(req, res) {
  const auth = req.headers?.authorization ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
    return res.status(500).json({ error: 'resend_not_configured' })
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'supabase_server_env_missing' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const resend = new Resend(process.env.RESEND_API_KEY)
  const fromEmail = process.env.FROM_EMAIL

  // 1. Candidate circles: trial active and still inside the 30-day window.
  //    Once trial_ends_at passes we stop sending — expiry collection lives
  //    in a separate handler (Stripe integration task).
  const nowIso = new Date().toISOString()
  const { data: circles, error: queryError } = await supabase
    .from('family_circles')
    .select('id, name, subscription_tier, trial_started_at, trial_ends_at, trial_emails_sent')
    .eq('subscription_tier', 'prepared')
    .not('trial_started_at', 'is', null)
    .gte('trial_ends_at', nowIso)

  if (queryError) {
    console.error('Trial cron: circle query failed:', queryError)
    return res.status(500).json({ error: 'query_failed', detail: queryError.message })
  }

  const now = Date.now()
  const actions = []

  for (const c of circles ?? []) {
    const sent = c.trial_emails_sent ?? {}
    const due = dueEmailKeys(c.trial_started_at, sent, now)
    if (due.length === 0) continue

    // 2. Find a reachable recipient. Disambiguated embed via persons!person_id
    //    (same PGRST201 pattern used elsewhere in the codebase). auth_id is
    //    included so we can fall back to the auth.users record when the
    //    persons.email column is null but the user has an auth account.
    const { data: members, error: memberErr } = await supabase
      .from('circle_memberships')
      .select('role, persons:persons!person_id (email, first_name, auth_id)')
      .eq('circle_id', c.id)
      .eq('status', 'active')
      .in('role', ['circle_manager', 'home_owner', 'care_partner'])

    if (memberErr) {
      console.error(`Trial cron: member query failed for circle ${c.id}:`, memberErr)
      actions.push({ circle: c.id, status: 'member_query_failed' })
      continue
    }

    // Resolve in priority order, stopping at the first reachable member.
    // First try persons.email (cheap, no extra round trip); only fall back
    // to auth.admin.getUserById(auth_id) when that's null but the user has
    // an auth account. Catches edge cases where persons.email was cleared
    // post-signup or diverged from the auth-stored address.
    const sorted = (members ?? []).sort(
      (a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99)
    )

    let target = null
    let resolvedEmail = null
    for (const m of sorted) {
      const p = m.persons
      if (!p) continue
      if (p.email) {
        target = m
        resolvedEmail = p.email
        break
      }
      if (p.auth_id) {
        const { data: au, error: authErr } = await supabase.auth.admin.getUserById(p.auth_id)
        if (authErr) {
          console.error(`Trial cron: auth lookup failed for ${p.auth_id}:`, authErr)
          continue
        }
        if (au?.user?.email) {
          target = m
          resolvedEmail = au.user.email
          break
        }
      }
    }

    if (!target || !resolvedEmail) {
      actions.push({ circle: c.id, status: 'no_reachable_recipient' })
      continue
    }

    // 3. Send each due email. Failed sends stay unmarked — next cron tick
    //    retries them. Per-send try/catch so one bad address can't poison
    //    the whole batch.
    const stampIso = new Date().toISOString()
    const updated = { ...sent }

    for (const key of due) {
      try {
        await resend.emails.send({
          from: fromEmail,
          to: resolvedEmail,
          subject: subjectFor(key),
          html: htmlFor(key, {
            firstName: target.persons.first_name,
            circleName: c.name,
            trialEndsAt: c.trial_ends_at,
          }),
        })
        updated[key] = stampIso
        actions.push({ circle: c.id, key, to: resolvedEmail, status: 'sent' })
      } catch (err) {
        console.error(`Trial cron: send ${key} → ${resolvedEmail} failed:`, err)
        actions.push({ circle: c.id, key, status: 'send_failed', error: err?.message })
      }
    }

    // 4. One UPDATE per circle, only if anything new was actually marked.
    //    Race-safe enough for daily cadence — a concurrent invocation
    //    would re-fetch and see the just-stamped keys before re-sending.
    const newlySent = Object.keys(updated).filter((k) => !(k in sent))
    if (newlySent.length > 0) {
      const { error: upErr } = await supabase
        .from('family_circles')
        .update({ trial_emails_sent: updated })
        .eq('id', c.id)
      if (upErr) {
        console.error(`Trial cron: stamp update failed for circle ${c.id}:`, upErr)
        actions.push({ circle: c.id, status: 'stamp_failed', error: upErr.message })
      }
    }
  }

  return res.status(200).json({
    ok: true,
    circles_scanned: circles?.length ?? 0,
    actions,
  })
}
