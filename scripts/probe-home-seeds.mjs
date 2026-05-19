// One-off probe: discover home_seeds schema + authenticated RLS visibility.
// Onboarding runs as an authenticated user, so we sign up an ephemeral one.
// Usage: node scripts/probe-home-seeds.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const stamp = Date.now()
const { data: su, error: suErr } = await supabase.auth.signUp({
  email: `probe+${stamp}@noworry-home.test`,
  password: 'ProbeTest!2026',
  options: { data: { first_name: 'Probe', last_name: 'Test' } },
})
if (suErr) { console.error('signup failed:', suErr.message); process.exit(1) }
if (!su.session) { console.error('no session (email confirmation on?)'); process.exit(1) }
console.log('authenticated as', su.user.email, '\n')

// 1. Readable? Columns?
const { data: rows, error: selErr, count } = await supabase
  .from('home_seeds')
  .select('*', { count: 'exact' })
  .limit(2)

if (selErr) {
  console.log('✗ select error:', selErr.code, selErr.message)
  console.log('  (if 42P01 → table missing; if empty+no error → RLS deny-all / no policy)')
} else if (!rows?.length) {
  console.log(`✗ 0 rows visible (count=${count}). Table exists but RLS likely denies authenticated reads — needs a SELECT policy.`)
} else {
  console.log(`✓ readable as authenticated. count≈${count}`)
  console.log('columns:', Object.keys(rows[0]).join(', '))
  console.log('\nsample row 1:')
  console.log(JSON.stringify(rows[0], null, 2))
}

// 2. Which search style works against the GIN index?
console.log('\n--- search style probe (address_line1) ---')
const ts = await supabase.from('home_seeds')
  .select('address_line1').textSearch('address_line1', 'main', { type: 'websearch' }).limit(2)
console.log('textSearch(websearch):', ts.error ? `err ${ts.error.code} ${ts.error.message}` : `${ts.data?.length ?? 0} rows`)

const il = await supabase.from('home_seeds')
  .select('address_line1').ilike('address_line1', '%main%').limit(2)
console.log('ilike %main%:', il.error ? `err ${il.error.code} ${il.error.message}` : `${il.data?.length ?? 0} rows`)
