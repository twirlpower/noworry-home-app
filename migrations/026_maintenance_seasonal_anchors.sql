-- ============================================================================
-- NoWorry Home — Migration 026: seasonal anchors + admin template manager
-- Run order: ..., 025_admin_crm_rls_realign.sql, then 026.
--
-- Problem: generate_maintenance_for_home() computes due dates as
-- (current_date + frequency_months months), which produces season-agnostic
-- dates — a furnace tune-up generated in July ends up due in July of the
-- next year instead of October (before heating season).
--
-- Solution: anchor each template to a target month (1–12). The function
-- computes the next occurrence of that month from today and uses it as
-- the due date. Biannual templates have a second target month; quarterly
-- templates derive four anchors spaced 3 months from target_month_1.
--
-- Extends maintenance_templates with the new columns (additive — keeps
-- the existing title / description / season / frequency_months / is_active
-- columns so the existing schema FKs from scheduled_maintenance keep
-- working). The admin UI labels title as "Task Name" and is_active as
-- "Active" to match the spec without renaming columns.
--
-- Also opens the table to staff WRITE policies (read was already
-- authenticated-wide from migration 004's maint_templates_select).
--
-- Idempotent.
-- ============================================================================

-- ── 1. Add new columns (additive) ───────────────────────────────────────────
alter table maintenance_templates
  add column if not exists target_month_1  integer
    check (target_month_1 between 1 and 12),
  add column if not exists target_month_2  integer
    check (target_month_2 between 1 and 12),
  add column if not exists covered_service boolean default false,
  add column if not exists sort_order      integer default 100,
  add column if not exists notes           text;

comment on column maintenance_templates.target_month_1 is
  'Primary seasonal anchor (1–12). The next occurrence of this month from '
  'today becomes the due date when generating scheduled_maintenance.';
comment on column maintenance_templates.target_month_2 is
  'Optional second anchor for biannual templates. NULL otherwise.';
comment on column maintenance_templates.covered_service is
  'TRUE if this task is included in the Covered tier and handled by the '
  'NoWorry Home vendor network.';


-- ── 2. Backfill existing seed rows with seasonal anchors ────────────────────
-- Mapping per the locked spec table for Aurora / Denver Metro.
-- title-keyed so it survives re-runs and minor seed-order changes.

update maintenance_templates set target_month_1 = 10, sort_order = 10, covered_service = true
  where title = 'Furnace inspection & tune-up';
update maintenance_templates set target_month_1 = 4,  sort_order = 20, covered_service = true
  where title = 'A/C inspection & tune-up';
update maintenance_templates set target_month_1 = 11, sort_order = 30, covered_service = true
  where title = 'Clean gutters & downspouts';
update maintenance_templates set target_month_1 = 4,  sort_order = 50, covered_service = false
  where title = 'Spring sprinkler activation';
update maintenance_templates set target_month_1 = 10, sort_order = 60, covered_service = false
  where title = 'Winterize sprinkler system';
update maintenance_templates set target_month_1 = 6,  sort_order = 70, covered_service = true
  where title = 'Flush water heater';
update maintenance_templates set target_month_1 = 10, sort_order = 80, covered_service = false
  where title = 'Snow removal prep';
-- Quarterly: target_month_1 is the Q1 anchor; +3, +6, +9 derived in the function.
update maintenance_templates set target_month_1 = 1,  sort_order = 90, covered_service = true
  where title = 'Replace HVAC filter';
-- Biannual: month_1 = March, month_2 = September.
update maintenance_templates set target_month_1 = 3,  target_month_2 = 9,
                                   sort_order = 100, covered_service = false
  where title = 'Test smoke & CO detectors';
update maintenance_templates set target_month_1 = 10, sort_order = 110, covered_service = false
  where title = 'Replace smoke/CO detector batteries';
update maintenance_templates set target_month_1 = 5,  sort_order = 120, covered_service = false
  where title = 'Exterior paint & caulk check';
update maintenance_templates set target_month_1 = 2,  sort_order = 130, covered_service = false
  where title = 'Clean dryer vent';
-- Existing 004/006 entries not in the spec's 13, but keep them anchored.
update maintenance_templates set target_month_1 = 5,  sort_order = 140
  where title = 'Roof inspection' and target_month_1 is null;
update maintenance_templates set target_month_1 = 10, sort_order = 150
  where title = 'Winterize exterior faucets' and target_month_1 is null;


-- ── 3. Add the missing "Gutter cleaning (spring)" template ──────────────────
insert into maintenance_templates
  (system_type, title, description, frequency_months, season,
   target_month_1, sort_order, covered_service)
select null,
       'Gutter cleaning (spring)',
       'Clear debris before spring rains. Pairs with the fall gutter cleaning.',
       12, 'spring', 3, 35, true
where not exists (
  select 1 from maintenance_templates m
  where m.title = 'Gutter cleaning (spring)' and m.system_type is null
);


-- ── 4. Staff write RLS (read was already auth-wide from migration 004) ──────
drop policy if exists "Staff write maintenance_templates"  on maintenance_templates;
drop policy if exists "Staff update maintenance_templates" on maintenance_templates;
drop policy if exists "Staff delete maintenance_templates" on maintenance_templates;

create policy "Staff write maintenance_templates"
  on maintenance_templates for insert
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff update maintenance_templates"
  on maintenance_templates for update
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  )
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff delete maintenance_templates"
  on maintenance_templates for delete
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );


-- ── 5. Helper: next-occurrence-of-target-month from today ───────────────────
-- Computes make_date(year, target_month, 1). If that day is in the past,
-- bumps to next year. Day-of-month is the 1st — friendly enough for a
-- "due in October" UX without committing to a specific day.

create or replace function public.next_target_month_date(
  p_target_month integer,
  p_today        date default current_date
)
returns date language sql immutable
set search_path = public
as $$
  with c as (
    select make_date(extract(year from p_today)::int, p_target_month, 1) as d
  )
  select case when c.d >= p_today then c.d
              else (c.d + interval '1 year')::date end
  from c
$$;


-- ── 6. Rewrite generate_maintenance_for_home with seasonal logic ────────────
-- For each active template, computes a SET of due dates:
--   * Quarterly (frequency_months <= 3): four anchors at target_month_1
--     and +3, +6, +9 (mod 12). Each resolved via next_target_month_date.
--   * Biannual (target_month_2 not null and frequency_months > 3):
--     two anchors (target_month_1 and target_month_2).
--   * Annual: single anchor (target_month_1).
-- Templates with target_month_1 = NULL are skipped (admin should set one).
-- Dedup: skip if a non-completed scheduled_maintenance row already exists
-- for the same (home_id, template_id, due_date, home_system_id) tuple.

create or replace function public.generate_maintenance_for_home(p_home_id uuid)
returns integer language plpgsql security definer
set search_path = public
as $$
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

  -- Skip the has_circle_role check when the caller is an active staff
  -- account (owner or staff role). Otherwise require Family-write.
  if not exists (
    select 1 from staff_accounts sa
    where sa.user_id = auth.uid()
      and sa.active = true
      and sa.role in ('owner','staff')
  ) then
    if not public.has_circle_role(
         v_circle,
         array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
       ) then
      raise exception 'Not authorized to generate maintenance for this home';
    end if;
  end if;

  -- Per-system templates: only fire for matching active home_systems.
  insert into scheduled_maintenance
    (home_id, home_system_id, template_id, circle_id, title, description, due_date)
  select p_home_id, hs.id, t.id, v_circle, t.title, t.description, dates.d
  from home_systems hs
  join maintenance_templates t
    on t.system_type = hs.system_type
   and t.is_active
   and t.target_month_1 is not null
  cross join lateral (
    -- Quarterly: 4 anchors.
    select public.next_target_month_date(((t.target_month_1 - 1 + om) % 12) + 1) as d
    from unnest(array[0, 3, 6, 9]) om
    where coalesce(t.frequency_months, 12) <= 3
    union all
    -- Biannual: 2 anchors.
    select public.next_target_month_date(t.target_month_1)
    where t.target_month_2 is not null and coalesce(t.frequency_months, 12) > 3
    union all
    select public.next_target_month_date(t.target_month_2)
    where t.target_month_2 is not null and coalesce(t.frequency_months, 12) > 3
    union all
    -- Annual: 1 anchor.
    select public.next_target_month_date(t.target_month_1)
    where t.target_month_2 is null and coalesce(t.frequency_months, 12) > 3
  ) dates
  where hs.home_id = p_home_id and hs.is_active
    and not exists (
      select 1 from scheduled_maintenance sm
      where sm.home_system_id = hs.id
        and sm.template_id = t.id
        and sm.due_date = dates.d
        and sm.is_completed = false
    );
  get diagnostics v_n = row_count;
  v_made := v_made + v_n;

  -- Home-level templates (system_type null): one set of dates per home.
  insert into scheduled_maintenance
    (home_id, home_system_id, template_id, circle_id, title, description, due_date)
  select p_home_id, null, t.id, v_circle, t.title, t.description, dates.d
  from maintenance_templates t
  cross join lateral (
    select public.next_target_month_date(((t.target_month_1 - 1 + om) % 12) + 1) as d
    from unnest(array[0, 3, 6, 9]) om
    where coalesce(t.frequency_months, 12) <= 3
    union all
    select public.next_target_month_date(t.target_month_1)
    where t.target_month_2 is not null and coalesce(t.frequency_months, 12) > 3
    union all
    select public.next_target_month_date(t.target_month_2)
    where t.target_month_2 is not null and coalesce(t.frequency_months, 12) > 3
    union all
    select public.next_target_month_date(t.target_month_1)
    where t.target_month_2 is null and coalesce(t.frequency_months, 12) > 3
  ) dates
  where t.system_type is null
    and t.is_active
    and t.target_month_1 is not null
    and not exists (
      select 1 from scheduled_maintenance sm
      where sm.home_id = p_home_id
        and sm.template_id = t.id
        and sm.home_system_id is null
        and sm.due_date = dates.d
        and sm.is_completed = false
    );
  get diagnostics v_n = row_count;
  v_made := v_made + v_n;

  return v_made;
end;
$$;

grant execute on function public.generate_maintenance_for_home(uuid) to authenticated;
revoke execute on function public.generate_maintenance_for_home(uuid) from anon;


-- ── 7. Owner-only bulk regenerate: delete incomplete, then regenerate ───────
-- Returns total rows inserted across all homes. Completed rows are
-- preserved per spec ("Completed tasks will be preserved.").

create or replace function public.admin_regenerate_all_maintenance()
returns integer language plpgsql security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_n     int := 0;
  v_home  record;
begin
  if not exists (
    select 1 from staff_accounts sa
    where sa.user_id = auth.uid()
      and sa.active = true
      and sa.role = 'owner'
  ) then
    raise exception 'Only an active owner can regenerate maintenance.';
  end if;

  -- Wipe incomplete rows. Completed history stays.
  delete from scheduled_maintenance where is_completed = false;

  -- Loop over every home that has an active circle.
  for v_home in
    select distinct h.id as home_id
    from homes h
    join circle_homes ch on ch.home_id = h.id and ch.status = 'active'
  loop
    v_n := public.generate_maintenance_for_home(v_home.home_id);
    v_total := v_total + v_n;
  end loop;

  return v_total;
end;
$$;

revoke execute on function public.admin_regenerate_all_maintenance() from public;
grant execute on function public.admin_regenerate_all_maintenance() to authenticated;
