// End-to-end smoke test: signup -> trigger -> onboarding RPC -> dashboard reads.
// Mirrors exactly what the app does (AuthContext + Onboarding + CircleContext +
// HomeProfile), using the anon key like the browser.
// Usage: node scripts/smoke-test.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const stamp = Date.now()
const email = `smoketest+${stamp}@noworry-home.test`
const password = 'SmokeTest!2026'
const ok = (s) => console.log(`  ✓ ${s}`)
const bad = (s) => { console.log(`  ✗ ${s}`); process.exitCode = 1 }

console.log(`Test account: ${email}\n`)

// 1. Signup (AuthContext.signUp): name in user_metadata, trigger makes persons.
console.log('1. Signup')
const { data: su, error: suErr } = await supabase.auth.signUp({
  email, password,
  options: { data: { first_name: 'Smoke', last_name: 'Test' } },
})
if (suErr) { bad(`signUp failed: ${suErr.message}`); process.exit() }
if (!su.session) {
  bad('signUp returned no session → email confirmation is still ON in Supabase Auth.')
  console.log('    Disable Auth → Providers → Email → "Confirm email", then re-run.')
  process.exit()
}
ok('account created with active session')

// 2. Trigger created the persons row, readable under persons_select RLS.
console.log('2. persons row from handle_new_user trigger')
const { data: person, error: pErr } = await supabase
  .from('persons').select('*').eq('auth_id', su.user.id).maybeSingle()
if (pErr) bad(`persons select errored: ${pErr.message}`)
else if (!person) bad('no persons row → trigger did not fire / RLS blocks own row')
else ok(`persons row present (${person.first_name} ${person.last_name})`)

// 3. Onboarding (self) via the atomic RPC.
console.log('3. setup_home_circle RPC (self)')
const { data: circleId, error: rErr } = await supabase.rpc('setup_home_circle', {
  p_setup_type: 'self',
  p_circle_name: 'Smoke Test Home Circle',
  p_home: { address_line1: '1 Test St', city: 'Denver', state: 'CO', zip: '80202', year_built: '1990' },
})
if (rErr) bad(`RPC failed: ${rErr.message}`)
else ok(`circle created (${circleId})`)

// 4. Dashboard data (CircleContext.loadCircles): memberships + circle join.
console.log('4. Dashboard reads (circle_memberships + family_circles)')
const { data: mems, error: mErr } = await supabase
  .from('circle_memberships')
  .select('*, family_circles (*)')
  .eq('person_id', person?.id)
  .eq('status', 'active')
if (mErr) bad(`memberships query errored: ${mErr.message}`)
else if (!mems?.length) bad('no active memberships visible under RLS')
else ok(`${mems.length} membership, role=${mems[0].role}, circle="${mems[0].family_circles?.name}"`)

// 5. HomeProfile read (circle_homes -> homes) under RLS.
console.log('5. HomeProfile read (circle_homes -> homes)')
const { data: ch, error: chErr } = await supabase
  .from('circle_homes')
  .select('is_primary, homes (*)')
  .eq('circle_id', circleId)
  .eq('status', 'active')
const homeId = ch?.[0]?.homes?.id
if (chErr) bad(`circle_homes query errored: ${chErr.message}`)
else if (!homeId) bad('home not visible under RLS')
else ok(`home visible (${ch[0].homes.address_line1}, ${ch[0].homes.city})`)

// 6. RLS v2 — home_systems write+read as home_owner (HOME_WRITE/READ).
console.log('6. home_systems insert + read (RLS v2)')
if (homeId) {
  const { error: insErr } = await supabase.from('home_systems').insert({
    home_id: homeId, system_type: 'hvac', name: 'Smoke Test Furnace',
  })
  if (insErr) bad(`home_systems insert blocked: ${insErr.message}`)
  else {
    const { data: sys } = await supabase
      .from('home_systems').select('*').eq('home_id', homeId)
    if (!sys?.length) bad('home_systems inserted but not visible under RLS')
    else {
      ok(`home_systems insert+read ok (${sys[0].name})`)
      const id = sys[0].id
      // Edit (UPDATE) — same v2 update policy as remove.
      const { error: edErr } = await supabase
        .from('home_systems').update({ name: 'Smoke Test Furnace (edited)' }).eq('id', id)
      if (edErr) bad(`home_systems edit blocked: ${edErr.message}`)
      else ok('home_systems edit ok')
      // Remove = soft-delete (is_active=false), then confirm it drops from the active list.
      const { error: rmErr } = await supabase
        .from('home_systems').update({ is_active: false }).eq('id', id)
      const { data: act } = await supabase
        .from('home_systems').select('id').eq('home_id', homeId).eq('is_active', true)
      if (rmErr) bad(`home_systems remove blocked: ${rmErr.message}`)
      else if (act?.length) bad('home_systems soft-removed but still in active list')
      else ok('home_systems remove (soft-delete) ok')
    }
  }
} else bad('skipped — no home id')

// 7. RLS v2 — scheduled_maintenance write+read (HOME_WRITE/READ).
console.log('7. scheduled_maintenance insert + read (RLS v2)')
{
  const { error: insErr } = await supabase.from('scheduled_maintenance').insert({
    home_id: homeId, circle_id: circleId,
    title: 'Smoke Test — replace furnace filter',
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  })
  if (insErr) bad(`scheduled_maintenance insert blocked: ${insErr.message}`)
  else {
    const { data: sm } = await supabase
      .from('scheduled_maintenance').select('*').eq('circle_id', circleId)
    if (sm?.length) ok(`scheduled_maintenance insert+read ok (${sm[0].title})`)
    else bad('scheduled_maintenance inserted but not visible under RLS')
  }
}

// 8. Migration 004 — generate_maintenance_for_home from seeded templates.
console.log('8. generate_maintenance_for_home (migration 004)')
if (homeId) {
  // Fresh active system (step 6 soft-deleted the first one).
  await supabase.from('home_systems').insert({
    home_id: homeId, system_type: 'hvac', name: 'Smoke Test Furnace 2',
  })
  const { data: made, error: genErr } = await supabase.rpc(
    'generate_maintenance_for_home', { p_home_id: homeId })
  if (genErr) {
    const missing = /could not find the function|PGRST202/i.test(genErr.message)
    bad(missing
      ? 'generate_maintenance_for_home not deployed — run migrations/004_maintenance_templates.sql'
      : `generate RPC failed: ${genErr.message}`)
  } else {
    const { data: gen } = await supabase
      .from('scheduled_maintenance')
      .select('*').eq('circle_id', circleId).not('template_id', 'is', null)
    if (gen?.length) ok(`generated ${made} item(s); ${gen.length} template-linked rows present`)
    else bad('RPC returned but no template-linked scheduled rows found')
  }
} else bad('skipped — no home id')

// 9. Migration 005 — safety_checklist upsert + read (Pillar-1 RLS).
console.log('9. safety_checklist upsert + read (migration 005)')
if (homeId) {
  const { error: upErr } = await supabase.from('safety_checklist').upsert(
    { home_id: homeId, circle_id: circleId, item_key: 'smoke_each_level', is_complete: true },
    { onConflict: 'home_id,item_key' }
  )
  if (upErr) {
    const missing = /relation .* does not exist|PGRST205|schema cache/i.test(upErr.message)
    bad(missing
      ? 'safety_checklist not deployed — run migrations/005_safety_checklist.sql'
      : `safety_checklist upsert blocked: ${upErr.message}`)
  } else {
    const { data: sc } = await supabase
      .from('safety_checklist').select('*').eq('home_id', homeId).eq('is_complete', true)
    if (sc?.length) ok(`safety_checklist upsert+read ok (${sc.length} item)`)
    else bad('safety_checklist upserted but not visible under RLS')
  }
} else bad('skipped — no home id')

// 10. Family invite — invited person (proxy, created_by me) + invited
//     membership, under deployed v1 RLS (persons_insert / memberships_insert).
console.log('10. family invite (persons + circle_memberships)')
const inviteEmail = `invite+${stamp}@noworry-home.test`
{
  const { data: inv, error: ipErr } = await supabase
    .from('persons')
    .insert({ first_name: 'Invited', last_name: 'Tester', email: inviteEmail, auth_status: 'proxy', created_by: person.id })
    .select().single()
  if (ipErr) bad(`invited persons insert blocked: ${ipErr.message}`)
  else {
    const { error: imErr } = await supabase.from('circle_memberships').insert({
      person_id: inv.id, circle_id: circleId, role: 'family_member',
      status: 'invited', invited_by: person.id,
    })
    if (imErr) bad(`invited membership insert blocked: ${imErr.message}`)
    else {
      const { data: roster, error: rosErr } = await supabase
        .from('circle_memberships')
        .select('status, persons!person_id (first_name)')
        .eq('circle_id', circleId)
      if (rosErr) bad(`roster select errored: ${rosErr.code} ${rosErr.message}`)
      else {
        const invited = (roster ?? []).filter((r) => r.status === 'invited')
        if (invited.length) ok(`invite ok (${invited.length} invited member visible)`)
        else bad('invited membership not visible under RLS')
      }
    }
  }
}

// 11. home_seeds address autocomplete (read as authenticated, GIN full-text).
console.log('11. home_seeds search (onboarding autocomplete)')
{
  const { data: seeds, error: seErr } = await supabase
    .from('home_seeds')
    .select('address_line1, year_built, square_feet, hvac_type, roof_type')
    .textSearch('address_line1', 'main:*')
    .limit(3)
  if (seErr) bad(`home_seeds search failed: ${seErr.code} ${seErr.message}`)
  else if (!seeds?.length) bad('home_seeds search returned 0 rows (RLS? index?)')
  else ok(`home_seeds searchable (${seeds.length} matches, e.g. "${seeds[0].address_line1}")`)
}

console.log(
  process.exitCode
    ? '\n✗ SMOKE TEST FAILED — see above.'
    : '\n✓ SMOKE TEST PASSED — signup → onboarding → dashboard + Pillar-1 RLS + invite works.'
)
console.log(
  `\nCleanup (run in Supabase SQL Editor, in this order):\n` +
  `  delete from safety_checklist where circle_id in (select id from family_circles where name = 'Smoke Test Home Circle');\n` +
  `  delete from scheduled_maintenance where circle_id in (select id from family_circles where name = 'Smoke Test Home Circle');\n` +
  `  delete from home_systems where home_id in (select home_id from circle_homes where circle_id in (select id from family_circles where name = 'Smoke Test Home Circle'));\n` +
  `  delete from circle_homes where circle_id in (select id from family_circles where name = 'Smoke Test Home Circle');\n` +
  `  delete from family_circles where name = 'Smoke Test Home Circle';\n` +
  `  delete from auth.users where email = '${email}';\n` +
  `  delete from persons where email in ('${email}', '${inviteEmail}');`
)
