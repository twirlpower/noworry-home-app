-- ============================================================================
-- NoWorry Home — Migration 039: Pillar 2 role lockdown
-- Run order: ..., 038_relationship_kind.sql, then 039.
-- Depends on has_circle_role() and is_active_member() (rls_policies_v1.sql),
--           current_person_id() (rls_policies_v1.sql),
--           care_coordinator + view_only role values (migration 014).
--
-- Security task — not a feature task. This closes the spec gap flagged in
-- Phase 3a's investigation:
--
--   "service_partner is NOT hard-blocked from emergency_contacts at the
--    RLS layer. Migration 013's emergency_contacts_select uses
--    is_active_member(circle_id), which any active membership satisfies."
--
-- Per Family Graph spec, Pillar 2 = documents, financial access, wishes,
-- emergency contacts. service_partner, helper, view_only roles must be
-- hard-blocked from these tables. trusted_advisor is handled separately
-- in migration 040 (granted-only access).
--
-- Approach: introduces has_pillar2_access(circle_id) as the explicit role
-- gate, defined in terms of the existing has_circle_role helper. We do
-- NOT replicate the (auth.uid() → persons.id → membership) query — that
-- pattern is centralized in current_person_id / has_circle_role and would
-- get the SECURITY DEFINER wrong (auth.uid() returns the auth-user UUID,
-- not persons.id, so a "person_id = auth.uid()" check would silently
-- return zero rows for every user — silent RLS bug).
--
-- Tables touched:
--   emergency_contacts SELECT — was is_active_member (gap); now
--                                has_pillar2_access (closed)
--   documents          SELECT — was an explicit role array already
--                                excluding service_partner/helper; the
--                                lockdown re-emits via has_pillar2_access
--                                for consistency and so migration 040
--                                can OR-extend the same policy with the
--                                grant carve-out
--
-- Write policies (INSERT/UPDATE/DELETE) on these tables already restrict
-- to home_owner / circle_manager / care_partner via explicit role arrays
-- (migrations 010 + 013 + 019); not re-emitting those — adding two
-- conflicting WITH CHECK clauses creates a debugging nightmare for a
-- security-critical surface.
--
-- financial_access and wishes tables don't exist in this codebase yet.
-- When they ship, they should call has_pillar2_access in their SELECT
-- policies from day one.
--
-- Idempotent (CREATE OR REPLACE + DROP POLICY IF EXISTS).
-- ============================================================================

-- ── has_pillar2_access ─────────────────────────────────────────────────────
-- Returns true when the calling user holds a Pillar-2-reading role in the
-- given circle. Excludes service_partner + helper + view_only (BLOCKED
-- per spec) and trusted_advisor (granted-only, handled in migration 040).
--
-- Composed from has_circle_role so the auth.uid() → persons mapping is
-- handled in one place. SECURITY DEFINER is required (the function reads
-- circle_memberships, which is itself RLS-protected, and an invoker-rights
-- function would deadlock on the same policy it's used by).

create or replace function public.has_pillar2_access(p_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_circle_role(
    p_circle_id,
    array[
      'home_owner',
      'circle_manager',
      'care_partner',
      'care_coordinator',
      'family_member'
    ]::circle_role[]
  )
$$;

revoke execute on function public.has_pillar2_access(uuid) from public;
grant  execute on function public.has_pillar2_access(uuid) to authenticated;

comment on function public.has_pillar2_access is
  'Returns true if caller has read access to Pillar 2 (documents, financial, wishes, emergency contacts) in the circle. Excludes service_partner / helper / view_only (hard-blocked) and trusted_advisor (granted-only, handled by advisor_has_grant in migration 040).';


-- ── emergency_contacts — close the gap ─────────────────────────────────────
-- Was: is_active_member (any active membership = read access).
-- Now: has_pillar2_access (Pillar-2 roles only).

drop policy if exists emergency_contacts_select on emergency_contacts;
create policy emergency_contacts_select on emergency_contacts for select
  using (public.has_pillar2_access(circle_id));


-- ── documents — re-emit via the new helper ─────────────────────────────────
-- The role array on documents_select (from migration 015) already excluded
-- service_partner + helper. The role-array vs has_pillar2_access changes
-- here are cosmetic — both yield the same set of rows today. The reason
-- to re-emit is to give migration 040 one anchor policy to OR-extend with
-- the trusted_advisor grant clause. Maintaining one policy is safer than
-- two policies that have to stay in sync.

drop policy if exists documents_select on documents;
create policy documents_select on documents for select
  using (public.has_pillar2_access(circle_id));
