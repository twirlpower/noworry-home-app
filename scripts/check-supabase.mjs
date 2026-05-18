// Verifies the Supabase connection and that the v1.0 schema is deployed.
// Usage: node scripts/check-supabase.mjs
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  } catch {
    console.error('✗ .env.local not found. Copy .env.example and fill in your values.')
    process.exit(1)
  }
  return env
}

const TABLES = [
  'persons', 'homes', 'home_systems', 'family_circles', 'circle_memberships',
  'circle_homes', 'maintenance_events', 'documents', 'tasks', 'succession_configs',
  'family_groups', 'family_group_circles', 'home_transfers', 'notifications',
  'notification_preferences', 'notes', 'emergency_contacts', 'audit_log',
  'maintenance_templates', 'scheduled_maintenance',
]

const env = loadEnv()
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY

if (!url || url.includes('your-project') || !key || key.includes('your-anon-key')) {
  console.error('✗ .env.local still has placeholder values.')
  process.exit(1)
}

console.log(`Connecting to ${url} …\n`)
const supabase = createClient(url, key)

let missing = 0
for (const table of TABLES) {
  const { error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  // RLS with no policies returns 0 rows but NO error if the table exists.
  // A missing table returns PostgREST 42P01 / "does not exist".
  if (error && (error.code === '42P01' || /does not exist|schema cache/i.test(error.message))) {
    console.log(`  ✗ ${table} — NOT FOUND`)
    missing++
  } else if (error) {
    console.log(`  ? ${table} — ${error.message}`)
  } else {
    console.log(`  ✓ ${table}`)
  }
}

console.log()
if (missing === 0) {
  console.log(`✓ All ${TABLES.length} tables present. Schema v1.0 is deployed.`)
  process.exit(0)
} else {
  console.log(`✗ ${missing}/${TABLES.length} tables missing. Run docs/noworry_home_schema_v1.0.sql in the Supabase SQL Editor.`)
  process.exit(1)
}
