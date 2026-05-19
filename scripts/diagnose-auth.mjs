// One-off diagnostic: did the RLS/trigger/RPC migration actually deploy?
// Usage: node scripts/diagnose-auth.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

console.log('1. setup_home_circle RPC exists?')
{
  const { error } = await supabase.rpc('setup_home_circle', {
    p_setup_type: 'self', p_circle_name: 'diag', p_home: {},
  })
  if (!error) console.log('   unexpected: succeeded as anon')
  else if (error.code === 'PGRST202') console.log('   ✗ NOT DEPLOYED — function not found (PGRST202)')
  else console.log(`   ✓ deployed — got expected error: [${error.code}] ${error.message}`)
}

console.log('2. current_person_id() helper exists?')
{
  const { error } = await supabase.rpc('current_person_id')
  if (!error) console.log('   ✓ deployed (callable)')
  else if (error.code === 'PGRST202') console.log('   ✗ NOT DEPLOYED — function not found (PGRST202)')
  else console.log(`   ✓ deployed — error: [${error.code}] ${error.message}`)
}

console.log('3. persons SELECT as anon (RLS sanity, expect 0 rows, no 406):')
{
  const { data, error } = await supabase.from('persons').select('id').limit(1)
  if (error) console.log(`   error: [${error.code}] ${error.message}`)
  else console.log(`   ok — ${data.length} rows (RLS denies anon, expected 0)`)
}

console.log('\nNote: the trigger on auth.users cannot be probed with the anon key;')
console.log('its effect is verified by signing up a NEW account after deploy.')
