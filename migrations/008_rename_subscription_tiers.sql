-- ============================================================================
-- NoWorry Home — Migration 008: rename subscription_tier enum values
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, 007 notif_prefs_rls, then 008.
--
-- Tier names changed:
--   home_base    → aware
--   organized    → prepared
--   peace_of_mind → covered
--   total_care   → complete
--
-- Schema (001) and the setup_home_circle function (002) now reference the new
-- names directly, so fresh installs get them on first run. This migration
-- catches already-deployed databases where the enum still has the old labels.
-- Each rename is guarded with an EXISTS check, so re-running on a database
-- that already has the new labels is a no-op.
-- ============================================================================

-- 1. Idempotent rename. Postgres has no IF EXISTS form for ALTER TYPE RENAME
--    VALUE, so we check pg_enum manually. Renaming preserves the underlying
--    OID, so existing rows and column defaults follow automatically.
do $$
begin
  if exists (select 1 from pg_enum e
             join pg_type t on t.oid = e.enumtypid
             where t.typname = 'subscription_tier' and e.enumlabel = 'home_base') then
    alter type subscription_tier rename value 'home_base' to 'aware';
  end if;

  if exists (select 1 from pg_enum e
             join pg_type t on t.oid = e.enumtypid
             where t.typname = 'subscription_tier' and e.enumlabel = 'organized') then
    alter type subscription_tier rename value 'organized' to 'prepared';
  end if;

  if exists (select 1 from pg_enum e
             join pg_type t on t.oid = e.enumtypid
             where t.typname = 'subscription_tier' and e.enumlabel = 'peace_of_mind') then
    alter type subscription_tier rename value 'peace_of_mind' to 'covered';
  end if;

  if exists (select 1 from pg_enum e
             join pg_type t on t.oid = e.enumtypid
             where t.typname = 'subscription_tier' and e.enumlabel = 'total_care') then
    alter type subscription_tier rename value 'total_care' to 'complete';
  end if;
end$$;

-- 2. Re-deploy setup_home_circle with the new literal. Already-deployed
--    databases ran the old 002 (which inserted 'home_base'); after step 1 the
--    enum no longer has that label, so the next call would raise
--    invalid_text_representation. This replaces the body to use 'aware'.
--    Definition is byte-identical to the updated rls_policies_v1.sql except
--    for the literal on line 145 → 'aware'.
create or replace function public.setup_home_circle(
  p_setup_type         text,
  p_circle_name        text,
  p_home               jsonb,
  p_owner_first        text default null,
  p_owner_last         text default null,
  p_owner_relationship text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor  uuid := public.current_person_id();
  v_home   uuid;
  v_circle uuid;
  v_owner  uuid;
begin
  if v_actor is null then
    raise exception 'No person record for the current user';
  end if;

  insert into homes (address_line1, address_line2, city, state, zip,
                      year_built, square_feet, bedrooms, bathrooms)
  values (
    p_home->>'address_line1', p_home->>'address_line2', p_home->>'city',
    p_home->>'state', p_home->>'zip',
    nullif(p_home->>'year_built', '')::int,
    nullif(p_home->>'square_feet', '')::int,
    nullif(p_home->>'bedrooms', '')::int,
    nullif(p_home->>'bathrooms', '')::numeric
  )
  returning id into v_home;

  insert into family_circles (name, subscription_tier)
  values (p_circle_name, 'aware')
  returning id into v_circle;

  insert into circle_homes (circle_id, home_id, is_primary)
  values (v_circle, v_home, true);

  if p_setup_type = 'self' then
    insert into circle_memberships (person_id, circle_id, role, status, joined_at)
    values (v_actor, v_circle, 'home_owner', 'active', now());
  else
    insert into persons (first_name, last_name, auth_status, created_by)
    values (p_owner_first, p_owner_last, 'proxy', v_actor)
    returning id into v_owner;

    insert into circle_memberships (person_id, circle_id, role, status, relationship, joined_at)
    values (v_owner, v_circle, 'home_owner', 'active', 'homeowner', now());

    insert into circle_memberships (person_id, circle_id, role, status, relationship, invited_by, joined_at)
    values (v_actor, v_circle, 'circle_manager', 'active', p_owner_relationship, v_actor, now());
  end if;

  return v_circle;
end;
$$;

grant execute on function
  public.setup_home_circle(text, text, jsonb, text, text, text)
to authenticated;
