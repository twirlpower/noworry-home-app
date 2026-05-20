-- ============================================================================
-- NoWorry Home — Migration 015: add care_coordinator to all RLS arrays that
--                                currently contain care_partner
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, 007 notif_prefs_rls, 008 tier_rename, 009 tasks_rls,
--            010 documents_rls, 011 trial_tracking, 012 trial_emails_sent,
--            013 emergency_contacts_rls, 014 role_enum_updates, then 015.
--
-- Scope: care_coordinator is the v1.5 rename of care_partner (per
-- src/lib/circleRoles.js — both are "Care Coordinator" semantically). To be
-- functionally equivalent, care_coordinator must appear in every role array
-- that currently includes care_partner, not just the 3-element Family-write
-- arrays. Otherwise a care_coordinator member can write to rows they can't
-- read (SELECT policies use Family-READ arrays with family_member, which the
-- literal-Family-write-only sweep wouldn't touch). Scope therefore expanded:
--
--   Old Family-write (3-elt): [home_owner, circle_manager, care_partner]
--   New                       : + care_coordinator → 4-elt
--
--   Old Family-read  (4-elt): [..., family_member]
--   New                       : + care_coordinator → 5-elt
--
--   Old Tasks/Docs   (5-elt): [..., family_member, trusted_advisor]
--   New                       : + care_coordinator → 6-elt
--
-- care_partner is intentionally KEPT in every array — existing members with
-- role='care_partner' retain access. Drop care_partner from the arrays only
-- after all live rows have been migrated to care_coordinator.
--
-- view_only (also new in migration 014) is NOT added here. It's read-only by
-- definition and currently has access only to the is_active_member-gated
-- tables (family_circles, emergency_contacts). To give view_only the same
-- read scope as family_member, a separate follow-up migration would add it
-- to every Family-read array. Out of scope for 015.
--
-- All statements are idempotent: DROP POLICY IF EXISTS + CREATE POLICY for
-- every policy, CREATE OR REPLACE FUNCTION for the two functions. Safe to
-- re-run.
-- ============================================================================


-- ── helper function: can_view_person (rls_policies_v1.sql L63) ──────────────
-- Used by persons_select. Whoever holds a Family-read role and shares a
-- circle with the target person can see that person. care_coordinator is now
-- a Family-read role.
create or replace function public.can_view_person(p_person_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from circle_memberships me
    join circle_memberships them on them.circle_id = me.circle_id
    where me.person_id = public.current_person_id()
      and me.status = 'active'
      and me.role = any (array['home_owner','circle_manager','care_partner','care_coordinator','family_member']::circle_role[])
      and them.person_id = p_person_id
      and them.status = 'active'
  )
$$;


-- ── family_circles ──────────────────────────────────────────────────────────
-- circles_select uses is_active_member (no role check) — no change needed.
drop policy if exists circles_update on family_circles;
create policy circles_update on family_circles for update
using   (public.has_circle_role(id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]))
with check (public.has_circle_role(id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]));


-- ── circle_memberships ──────────────────────────────────────────────────────
drop policy if exists memberships_select on circle_memberships;
create policy memberships_select on circle_memberships for select using (
  person_id = public.current_person_id()
  or public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member']::circle_role[])
);

drop policy if exists memberships_insert on circle_memberships;
create policy memberships_insert on circle_memberships for insert with check (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[])
);

drop policy if exists memberships_update on circle_memberships;
create policy memberships_update on circle_memberships for update
using   (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]))
with check (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]));


-- ── circle_homes ────────────────────────────────────────────────────────────
drop policy if exists circle_homes_select on circle_homes;
create policy circle_homes_select on circle_homes for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member']::circle_role[])
);

drop policy if exists circle_homes_update on circle_homes;
create policy circle_homes_update on circle_homes for update
using   (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]))
with check (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]));


-- ── homes ───────────────────────────────────────────────────────────────────
drop policy if exists homes_select on homes;
create policy homes_select on homes for select using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = homes.id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member']::circle_role[])
  )
);

drop policy if exists homes_update on homes;
create policy homes_update on homes for update
using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = homes.id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[])
  )
)
with check (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = homes.id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[])
  )
);


-- ── home_systems (rls_policies_v2.sql) ──────────────────────────────────────
drop policy if exists home_systems_select on home_systems;
create policy home_systems_select on home_systems for select using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member']::circle_role[])
  )
);

drop policy if exists home_systems_insert on home_systems;
create policy home_systems_insert on home_systems for insert with check (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[])
  )
);

drop policy if exists home_systems_update on home_systems;
create policy home_systems_update on home_systems for update
using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[])
  )
)
with check (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[])
  )
);


-- ── scheduled_maintenance (rls_policies_v2.sql) ─────────────────────────────
drop policy if exists sched_maint_select on scheduled_maintenance;
create policy sched_maint_select on scheduled_maintenance for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member']::circle_role[])
);

drop policy if exists sched_maint_insert on scheduled_maintenance;
create policy sched_maint_insert on scheduled_maintenance for insert with check (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[])
);

drop policy if exists sched_maint_update on scheduled_maintenance;
create policy sched_maint_update on scheduled_maintenance for update
using   (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]))
with check (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]));


-- ── safety_checklist (005_safety_checklist.sql) ─────────────────────────────
drop policy if exists safety_select on safety_checklist;
create policy safety_select on safety_checklist for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator','family_member']::circle_role[])
);

drop policy if exists safety_insert on safety_checklist;
create policy safety_insert on safety_checklist for insert with check (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[])
);

drop policy if exists safety_update on safety_checklist;
create policy safety_update on safety_checklist for update
using   (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]))
with check (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]));


-- ── tasks (009_tasks_rls.sql) ───────────────────────────────────────────────
-- SELECT array is the extended 5-elt set (adds trusted_advisor); preserved.
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator',
          'family_member','trusted_advisor']::circle_role[]
  )
  or (
    public.has_circle_role(circle_id, array['service_partner','helper']::circle_role[])
    and assigned_to = public.current_person_id()
  )
);

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
  and created_by = public.current_person_id()
);

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
  or assigned_to = public.current_person_id()
)
with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
  or assigned_to = public.current_person_id()
);


-- ── documents table (010_documents_rls.sql) ─────────────────────────────────
drop policy if exists documents_select on documents;
create policy documents_select on documents for select using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator',
          'family_member','trusted_advisor']::circle_role[]
  )
);

drop policy if exists documents_insert on documents;
create policy documents_insert on documents for insert with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
  and uploaded_by = public.current_person_id()
);

drop policy if exists documents_update on documents;
create policy documents_update on documents for update
using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
)
with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
);


-- ── documents bucket (storage.objects, 010_documents_rls.sql) ───────────────
-- Object key convention: '<circle_id>/<uuid>-<filename>'. Storage policies
-- recover the circle scope from the first folder segment.
drop policy if exists documents_bucket_read on storage.objects;
create policy documents_bucket_read on storage.objects for select
to authenticated using (
  bucket_id = 'documents'
  and public.has_circle_role(
    ((storage.foldername(name))[1])::uuid,
    array['home_owner','circle_manager','care_partner','care_coordinator',
          'family_member','trusted_advisor']::circle_role[]
  )
);

drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects for insert
to authenticated with check (
  bucket_id = 'documents'
  and public.has_circle_role(
    ((storage.foldername(name))[1])::uuid,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
);

drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete on storage.objects for delete
to authenticated using (
  bucket_id = 'documents'
  and public.has_circle_role(
    ((storage.foldername(name))[1])::uuid,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
);


-- ── emergency_contacts (013_emergency_contacts_rls.sql) ─────────────────────
-- SELECT uses is_active_member only — no role-array change needed.
drop policy if exists emergency_contacts_insert on emergency_contacts;
create policy emergency_contacts_insert on emergency_contacts for insert with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
);

drop policy if exists emergency_contacts_update on emergency_contacts;
create policy emergency_contacts_update on emergency_contacts for update
using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
)
with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
);

drop policy if exists emergency_contacts_delete on emergency_contacts;
create policy emergency_contacts_delete on emergency_contacts for delete using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
);


-- ── generate_maintenance_for_home function (004_maintenance_templates.sql) ──
-- The internal permission guard. care_coordinator should be able to trigger
-- regeneration the same way care_partner can.
create or replace function public.generate_maintenance_for_home(p_home_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_circle uuid;
  v_made   int := 0;
  v_n      int := 0;
begin
  select ch.circle_id into v_circle
  from circle_homes ch
  where ch.home_id = p_home_id and ch.status = 'active'
  order by ch.is_primary desc
  limit 1;

  if v_circle is null then
    raise exception 'No active circle for this home';
  end if;

  if not public.has_circle_role(
       v_circle, array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]) then
    raise exception 'Not authorized to generate maintenance for this home';
  end if;

  -- Per-system: one row per (active system, matching active template).
  insert into scheduled_maintenance
    (home_id, home_system_id, template_id, circle_id, title, description, due_date)
  select p_home_id, hs.id, t.id, v_circle, t.title, t.description,
         current_date + make_interval(months => t.frequency_months)
  from home_systems hs
  join maintenance_templates t
    on t.system_type = hs.system_type and t.is_active
  where hs.home_id = p_home_id and hs.is_active
    and not exists (
      select 1 from scheduled_maintenance sm
      where sm.home_system_id = hs.id and sm.template_id = t.id
        and sm.is_completed = false
    );
  get diagnostics v_n = row_count;
  v_made := v_made + v_n;

  -- Home-level: one row per home for each null-type template.
  insert into scheduled_maintenance
    (home_id, home_system_id, template_id, circle_id, title, description, due_date)
  select p_home_id, null, t.id, v_circle, t.title, t.description,
         current_date + make_interval(months => t.frequency_months)
  from maintenance_templates t
  where t.system_type is null and t.is_active
    and not exists (
      select 1 from scheduled_maintenance sm
      where sm.home_id = p_home_id and sm.template_id = t.id
        and sm.home_system_id is null and sm.is_completed = false
    );
  get diagnostics v_n = row_count;
  v_made := v_made + v_n;

  return v_made;
end;
$$;

grant execute on function public.generate_maintenance_for_home(uuid) to authenticated;
