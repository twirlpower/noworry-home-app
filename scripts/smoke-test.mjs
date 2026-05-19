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
    if (sys?.length) ok(`home_systems insert+read ok (${sys[0].name})`)
    else bad('home_systems inserted but not visible under RLS')
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

console.log(
  process.exitCode
    ? '\n✗ SMOKE TEST FAILED — see above.'
    : '\n✓ SMOKE TEST PASSED — signup → onboarding → dashboard + Pillar-1 RLS works.'
)
console.log(
  `\nCleanup (run in Supabase SQL Editor, in this order):\n` +
  `  delete from scheduled_maintenance where circle_id in (select id from family_circles where name = 'Smoke Test Home Circle');\n` +
  `  delete from home_systems where name = 'Smoke Test Furnace';\n` +
  `  delete from family_circles where name = 'Smoke Test Home Circle';\n` +
  `  delete from auth.users where email = '${email}';\n` +
  `  delete from persons where email = '${email}';`
)
