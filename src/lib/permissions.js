// Role-based permission helpers for the app layer.
//
// RLS is the source of truth — these helpers exist so the UI knows
// whether to render a surface before issuing a query that would return
// zero rows. Always match what the DB enforces; if a row check disagrees
// with RLS, the DB wins.

import { supabase } from './supabase'

// Roles with full Pillar 2 read access. Mirrors has_pillar2_access in
// migration 039.
const PILLAR2_ROLES = new Set([
  'home_owner',
  'circle_manager',
  'care_partner',
  'care_coordinator',
  'family_member',
])

// Roles hard-blocked from Pillar 2 reads. The DB enforces this; the
// frontend just uses it to hide UI surfaces.
const PILLAR2_BLOCKED_ROLES = new Set([
  'service_partner',
  'helper',
  'view_only',
])

export function hasPillar2Access(role) {
  return PILLAR2_ROLES.has(role)
}

export function isPillar2Blocked(role) {
  return PILLAR2_BLOCKED_ROLES.has(role)
}

export function isTrustedAdvisor(role) {
  return role === 'trusted_advisor'
}

// Returns the set of granted resource ids for the given advisor on the
// given circle. Shape:
//   {
//     document:           Set<uuid>,
//     emergency_contact:  Set<uuid>,
//     wish:               Set<uuid>,
//     financial_account:  Set<uuid>,
//   }
// Returns null on query error. RLS scopes the rows: a non-admin advisor
// only sees their own grants (advisor_grants_self_select policy).
export async function getAdvisorGrants(circleId, advisorPersonId) {
  const empty = {
    document:           new Set(),
    emergency_contact:  new Set(),
    wish:               new Set(),
    financial_account:  new Set(),
  }

  if (!circleId || !advisorPersonId) return empty

  const { data, error } = await supabase
    .from('advisor_grants')
    .select('resource_type, resource_id')
    .eq('circle_id', circleId)
    .eq('advisor_person_id', advisorPersonId)
    .is('revoked_at', null)

  if (error || !data) return null

  for (const g of data) {
    if (empty[g.resource_type]) empty[g.resource_type].add(g.resource_id)
  }
  return empty
}
