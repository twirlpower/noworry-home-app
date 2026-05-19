// Isolate why an invited circle_membership isn't visible on read-back.
// Tests the exact predicate memberships_select uses (has_circle_role) and
// whether a non-own membership row is selectable.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const stamp = Date.now()

const { data: su } = await supabase.auth.signUp({
  email: `diaginv+${stamp}@noworry-home.test`,
  password: 'Diag!2026',
  options: { data: { first_name: 'Diag', last_name: 'Inv' } },
})
if (!su?.session) { console.error('no session'); process.exit(1) }

const { data: me } = await supabase.from('persons').select('id').eq('auth_id', su.user.id).maybeSingle()
const { data: circleId } = await supabase.rpc('setup_home_circle', {
  p_setup_type: 'self', p_circle_name: 'Diag Invite Circle',
  p_home: { address_line1: '2 Diag St', city: 'Aurora', state: 'CO', zip: '80012' },
})
console.log('person id:', me?.id)
console.log('circle id:', circleId, '\n')

// Probe the helper functions memberships_select depends on.
const cpi = await supabase.rpc('current_person_id')
console.log('current_person_id():', cpi.error ? `ERR ${cpi.error.message}` : cpi.data)

const iam = await supabase.rpc('is_active_member', { p_circle_id: circleId })
console.log('is_active_member(circle):', iam.error ? `ERR ${iam.error.message}` : iam.data)

const hcr = await supabase.rpc('has_circle_role', {
  p_circle_id: circleId,
  p_roles: ['home_owner', 'circle_manager', 'care_partner', 'family_member'],
})
console.log('has_circle_role(circle, [read set]):', hcr.error ? `ERR ${hcr.error.code} ${hcr.error.message}` : hcr.data)

// Insert an invited person + membership.
const { data: inv, error: ipErr } = await supabase.from('persons')
  .insert({ first_name: 'Inv', last_name: 'Person', auth_status: 'proxy', created_by: me.id })
  .select().single()
console.log('\ninvited person insert:', ipErr ? `ERR ${ipErr.message}` : inv.id)

const { data: imRow, error: imErr } = await supabase.from('circle_memberships')
  .insert({ person_id: inv.id, circle_id: circleId, role: 'family_member', status: 'invited', invited_by: me.id })
  .select()
console.log('invited membership insert:', imErr ? `ERR ${imErr.code} ${imErr.message}` : `inserted, returned ${imRow?.length ?? 0} row(s)`)

// Read-back: count, own-only?, by-id.
const all = await supabase.from('circle_memberships').select('id, person_id, role, status').eq('circle_id', circleId)
console.log('\nroster select (eq circle_id):', all.error ? `ERR ${all.error.message}` : `${all.data.length} row(s)`)
for (const r of all.data ?? []) console.log('  -', r.role, r.status, r.person_id === me.id ? '(me)' : '(other)')

// Reproduce the smoke/Circle.jsx embed (3 FKs to persons → ambiguous) and the fix.
const ambig = await supabase.from('circle_memberships')
  .select('status, persons (first_name)').eq('circle_id', circleId)
console.log('\nembed persons(...) [ambiguous]:',
  ambig.error ? `ERR ${ambig.error.code} ${ambig.error.message}` : `${ambig.data?.length ?? 0} row(s)`)

const fixed = await supabase.from('circle_memberships')
  .select('status, persons!person_id (first_name)').eq('circle_id', circleId)
console.log('embed persons!person_id(...) [fix]:',
  fixed.error ? `ERR ${fixed.error.code} ${fixed.error.message}` : `${fixed.data?.length ?? 0} row(s)`)

console.log('\nCleanup: delete from family_circles where name = \'Diag Invite Circle\';')
console.log(`         delete from auth.users where email = 'diaginv+${stamp}@noworry-home.test';`)
