-- ============================================================================
-- NoWorry Home — Migration 016: add view_only to all Family-READ RLS arrays
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, 007 notif_prefs_rls, 008 tier_rename, 009 tasks_rls,
--            010 documents_rls, 011 trial_tracking, 012 trial_emails_sent,
--            013 emergency_contacts_rls, 014 role_enum_updates,
--            015 care_coordinator_rls_parity, then 016.
--
-- Scope: view_only was added to circle_role in migration 014 but currently
-- can only see is_active_member-gated tables (family_circles, emergency_contacts).
-- The label promises read-only access to the home record; today it sees almost
-- nothing. This migration adds view_only to every Family-READ array so it has
-- the same SELECT scope as family_member.
--
-- view_only is NOT added to any write array. It cannot INSERT / UPDATE / DELETE
-- on any table. Write parity is intentionally withheld — the role is read-only
-- by definition (per migration 015 header note).
--
--   Old Family-read (5-elt after 015):
--     [home_owner, circle_manager, care_partner, care_coordinator, family_member]
--   New                              : + view_only → 6-elt
--
--   Old Tasks/Docs (6-elt after 015):
--     [...family_member, trusted_advisor]
--   New                              : + view_only → 7-elt
--
-- care_partner is intentionally KEPT (matches 015's reasoning — existing
-- care_partner rows retain access until they're migrated to care_coordinator).
--
-- All statements are idempotent: DROP POLICY IF EXISTS + CREATE POLICY for
-- every policy, CREATE OR REPLACE FUNCTION for can_view_person. Safe to re-run.
-- ============================================================================


-- ── helper function: can_view_person (rls_policies_v1.sql L63) ──────────────
-- Used by persons_select. A view_only member should be able to see the other
-- people they share a circle with (otherwise the My Circle roster is empty
-- for them).
create or replace function public.can_view_person(p_person_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from circle_memberships me
    join circle_memberships them on them.circle_id = me.circle_id
    where me.person_id = public.current_person_id()
      and me.status = 'active'
      and me.role = any (array['home_owner','circle_manager','care_partner','care_coordinator','family_member','view_only']::circle_role[])
      and them.person_id = p_person_id
      and them.status = 'active'
  )
$$;


-- ── family_circles ──────────────────────────────────────────────────────────
-- circles_select uses is_active_member (no role check) — view_only already
-- passes that gate via migration 013/014. No change needed here.


-- ── circle_memberships ──────────────────────────────────────────────────────
drop policy if exists memberships_select on circle_memberships;
create policy memberships_select on circle_memberships for select using (
  person_id = public.current_person_id()
  or public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member','view_only']::circle_role[])
);


-- ── circle_homes ────────────────────────────────────────────────────────────
drop policy if exists circle_homes_select on circle_homes;
create policy circle_homes_select on circle_homes for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member','view_only']::circle_role[])
);


-- ── homes ───────────────────────────────────────────────────────────────────
drop policy if exists homes_select on homes;
create policy homes_select on homes for select using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = homes.id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member','view_only']::circle_role[])
  )
);


-- ── home_systems (rls_policies_v2.sql) ──────────────────────────────────────
drop policy if exists home_systems_select on home_systems;
create policy home_systems_select on home_systems for select using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member','view_only']::circle_role[])
  )
);


-- ── scheduled_maintenance (rls_policies_v2.sql) ─────────────────────────────
drop policy if exists sched_maint_select on scheduled_maintenance;
create policy sched_maint_select on scheduled_maintenance for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member','view_only']::circle_role[])
);


-- ── safety_checklist (005_safety_checklist.sql) ─────────────────────────────
drop policy if exists safety_select on safety_checklist;
create policy safety_select on safety_checklist for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member','view_only']::circle_role[])
);


-- ── tasks (009_tasks_rls.sql) ───────────────────────────────────────────────
-- SELECT array is the extended 7-elt set (adds trusted_advisor + view_only).
-- The service_partner / helper branch is unchanged — view_only never holds
-- task assignments, so it doesn't need the assigned_to escape hatch.
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator',
          'family_member','trusted_advisor','view_only']::circle_role[]
  )
  or (
    public.has_circle_role(circle_id, array['service_partner','helper']::circle_role[])
    and assigned_to = public.current_person_id()
  )
);


-- ── documents table (010_documents_rls.sql) ─────────────────────────────────
drop policy if exists documents_select on documents;
create policy documents_select on documents for select using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator',
          'family_member','trusted_advisor','view_only']::circle_role[]
  )
);


-- ── documents bucket (storage.objects, 010_documents_rls.sql) ───────────────
-- Read-only on the bucket. INSERT / DELETE policies are NOT updated — view_only
-- cannot upload or remove files.
drop policy if exists documents_bucket_read on storage.objects;
create policy documents_bucket_read on storage.objects for select
to authenticated using (
  bucket_id = 'documents'
  and public.has_circle_role(
    ((storage.foldername(name))[1])::uuid,
    array['home_owner','circle_manager','care_partner','care_coordinator',
          'family_member','trusted_advisor','view_only']::circle_role[]
  )
);


-- ── emergency_contacts (013_emergency_contacts_rls.sql) ─────────────────────
-- SELECT uses is_active_member only — view_only already reads via that gate.
-- INSERT / UPDATE / DELETE intentionally NOT updated (read-only role).
