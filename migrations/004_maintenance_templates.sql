-- ============================================================================
-- NoWorry Home — Migration 004: maintenance templates + auto-generation
-- Run order: 001 = migrations/noworry_home_schema_v1.0.sql,
--            002 = migrations/rls_policies_v1.sql,
--            003 = migrations/rls_policies_v2.sql, then this (004).
-- Depends on v1 helpers (current_person_id, has_circle_role).
-- Run in the Supabase SQL Editor. Idempotent: safe to re-run.
-- ============================================================================

-- ── maintenance_templates: read-only system data ────────────────────────────
-- Global (not circle-scoped). Any authenticated user may read; no client
-- write policy — templates are seeded by migration / admin only.

drop policy if exists maint_templates_select on maintenance_templates;
create policy maint_templates_select on maintenance_templates for select
using (auth.uid() is not null);

-- ── Seed templates (Colorado-oriented) ──────────────────────────────────────
-- Idempotent: only inserts a (system_type, title) pair that isn't present.

-- System-specific templates (generated per matching home_system).
insert into maintenance_templates (system_type, title, description, frequency_months, season)
select v.system_type::home_system_type, v.title, v.description, v.frequency_months, v.season
from (values
  ('hvac',         'Replace HVAC filter',            'Swap the furnace/AC air filter.',                          3,  null),
  ('hvac',         'Furnace inspection & tune-up',   'Annual heating system service before winter.',             12, 'fall'),
  ('hvac',         'A/C inspection & tune-up',       'Annual cooling system service before summer.',             12, 'spring'),
  ('water_heater', 'Flush water heater',             'Drain sediment to extend tank life.',                      12, null),
  ('roof',         'Roof inspection',                'Check for hail/wind damage (Colorado).',                   12, 'spring'),
  ('plumbing',     'Winterize exterior faucets',     'Shut off and drain hose bibs before the first freeze.',    12, 'fall')
) as v(system_type, title, description, frequency_months, season)
where not exists (
  select 1 from maintenance_templates m
  where m.title = v.title
    and m.system_type is not distinct from v.system_type::home_system_type
);

-- Home-level templates (system_type null) — generated once per home.
insert into maintenance_templates (system_type, title, description, frequency_months, season)
select null, v.title, v.description, v.frequency_months, v.season
from (values
  ('Test smoke & CO detectors', 'Test alarms and replace batteries.',          6,  null),
  ('Clean gutters & downspouts','Clear debris before fall/winter.',            12, 'fall')
) as v(title, description, frequency_months, season)
where not exists (
  select 1 from maintenance_templates m
  where m.title = v.title and m.system_type is null
);

-- ── generate_maintenance_for_home(home_id) ──────────────────────────────────
-- Explicit RPC (chosen strategy). SECURITY DEFINER, so it bypasses RLS — and
-- therefore re-checks authorization itself (caller must be a Home-write role
-- in the home's active circle). Dedupes against open (not completed) rows.
-- Returns the number of scheduled_maintenance rows created.

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
       v_circle, array['home_owner','circle_manager','care_partner']::circle_role[]) then
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
