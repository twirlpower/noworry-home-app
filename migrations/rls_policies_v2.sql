-- ============================================================================
-- NoWorry Home — RLS Policies v2
-- Adds: home_systems, scheduled_maintenance  (both Pillar 1: Home)
-- Depends on the helper functions from rls_policies_v1.sql
-- (current_person_id, has_circle_role) — run v1 first.
-- Run in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Same Pillar-1 role sets as homes/circle_homes:
--   HOME_READ  = {home_owner, circle_manager, care_partner, family_member}
--   HOME_WRITE = {home_owner, circle_manager, care_partner}
-- Service Partner / Helper reach Home only via tasks (future); Trusted
-- Advisor has no Home access.
-- ============================================================================

-- ── home_systems ────────────────────────────────────────────────────────────
-- Tied to a home (no circle_id). Reached through the circle that the home is
-- actively linked to via circle_homes — mirrors the homes policies.

drop policy if exists home_systems_select on home_systems;
create policy home_systems_select on home_systems for select using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','family_member']::circle_role[])
  )
);

drop policy if exists home_systems_insert on home_systems;
create policy home_systems_insert on home_systems for insert with check (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner']::circle_role[])
  )
);

drop policy if exists home_systems_update on home_systems;
create policy home_systems_update on home_systems for update
using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner']::circle_role[])
  )
)
with check (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = home_systems.home_id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner']::circle_role[])
  )
);

-- ── scheduled_maintenance ───────────────────────────────────────────────────
-- Has circle_id directly → gate on it (read for Home-read roles, write for
-- Home-write roles; completing an item is an UPDATE).

drop policy if exists sched_maint_select on scheduled_maintenance;
create policy sched_maint_select on scheduled_maintenance for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','family_member']::circle_role[])
);

drop policy if exists sched_maint_insert on scheduled_maintenance;
create policy sched_maint_insert on scheduled_maintenance for insert with check (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[])
);

drop policy if exists sched_maint_update on scheduled_maintenance;
create policy sched_maint_update on scheduled_maintenance for update
using   (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[]))
with check (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[]));

-- ============================================================================
-- Still deny-all (no client policy) after v2: maintenance_events, documents,
-- tasks, succession_configs, family_groups, family_group_circles,
-- home_transfers, notifications, notification_preferences, notes,
-- emergency_contacts, audit_log, maintenance_templates.
-- ============================================================================
