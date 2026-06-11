-- ============================================================================
-- NoWorry Home — Migration 046: Path A self-setup → circle_manager role
-- Run order: ..., 045_circle_vendors.sql, then 046.
--
-- PROBLEM
-- setup_home_circle for p_setup_type = 'self' inserted one membership
-- row with role = 'home_owner'. availableViews('home_owner') returns
-- only ['homeowner'], so a self-setup homeowner cannot reach the admin,
-- billing, or member-management pages for their own circle.
--
-- WHY A SECOND INSERT CANNOT SOLVE THIS
-- circle_memberships carries a unique constraint:
--
--   constraint unique_person_circle unique (person_id, circle_id)
--                               -- noworry_home_schema_v1.0.sql line 188
--
-- Inserting a second circle_manager row for the same (person_id,
-- circle_id) violates that constraint. The fix must change the role on
-- the single existing row.
--
-- FIX
-- For p_setup_type = 'self', insert role = 'circle_manager' instead of
-- 'home_owner'. Every RLS policy that permits home_owner also permits
-- circle_manager in the same role array (rls_policies_v1.sql), so data
-- access is identical. availableViews('circle_manager') returns
-- ['family', 'admin', 'homeowner'] — all three views.
--
-- relationship_kind = 'self' is stamped directly in the INSERT so the
-- client-side best-effort UPDATE in Onboarding.jsx becomes a safe no-op
-- (sets 'self' when already 'self') rather than the only source of truth.
--
-- Path B is unchanged: the proxy homeowner keeps role = 'home_owner'
-- (auth_id IS NULL, never signs in themselves) and the acting person
-- keeps role = 'circle_manager'. No constraint conflict because they
-- are different person_ids.
--
-- BACKFILL
-- Existing Path A users already have home_owner rows that need to be
-- promoted to circle_manager. Safe filter:
--   • persons.auth_id IS NOT NULL — real account; proxy homeowners
--     (Path B) have auth_id IS NULL and must remain home_owner.
--   • No active circle_manager exists on the same circle — if one
--     already exists, the circle was set up by someone else (Path B)
--     and we must not overwrite the proxy homeowner row.
--
-- Idempotent: CREATE OR REPLACE on the function; the UPDATE only
-- touches rows that are still home_owner (already-promoted rows are
-- circle_manager and fail the WHERE clause).
-- ============================================================================


-- ── 1. Update setup_home_circle ───────────────────────────────────────────────

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
    -- The acting user is both homeowner and circle admin. A single
    -- circle_manager row covers all home_owner permissions (every RLS
    -- policy that allows home_owner also allows circle_manager).
    -- relationship_kind = 'self' signals that this person is the
    -- homeowner — used by getHomeDisplayName() ("My Home") and
    -- analytics. Stamping it here makes the post-RPC client UPDATE in
    -- Onboarding.jsx a harmless no-op rather than the sole source of
    -- truth.
    insert into circle_memberships
      (person_id, circle_id, role, status, relationship_kind, joined_at)
    values
      (v_actor, v_circle, 'circle_manager', 'active', 'self', now());

  else
    -- Path B: actor is setting up on behalf of someone else.
    -- Proxy homeowner — no auth account, never logs in directly.
    insert into persons (first_name, last_name, auth_status, created_by)
    values (p_owner_first, p_owner_last, 'proxy', v_actor)
    returning id into v_owner;

    insert into circle_memberships
      (person_id, circle_id, role, status, relationship, joined_at)
    values
      (v_owner, v_circle, 'home_owner', 'active', 'homeowner', now());

    -- Acting circle manager. relationship_kind is set by the client
    -- after the RPC returns (the picker value from Onboarding.jsx).
    insert into circle_memberships
      (person_id, circle_id, role, status, relationship, invited_by, joined_at)
    values
      (v_actor, v_circle, 'circle_manager', 'active', p_owner_relationship, v_actor, now());
  end if;

  return v_circle;
end;
$$;

-- GRANT is unchanged — same function name and signature as in
-- rls_policies_v1.sql; the existing grant to 'authenticated' remains
-- in effect and does not need to be re-issued.


-- ── 2. Backfill existing Path A home_owner rows → circle_manager ──────────────
--
-- Targets rows where:
--   a. role is still 'home_owner' and status is 'active'
--   b. The person has a real Supabase auth account (auth_id IS NOT NULL)
--      — proxy homeowners from Path B have auth_id IS NULL and must
--        stay home_owner.
--   c. No active circle_manager already exists for the same circle
--      — if one does, another real person is managing that circle
--        (Path B setup) and we must not touch the proxy's row.

update circle_memberships cm
   set role              = 'circle_manager',
       relationship_kind = 'self'
  from persons p
 where cm.person_id = p.id
   and cm.role      = 'home_owner'
   and cm.status    = 'active'
   and p.auth_id is not null
   and not exists (
         select 1
           from circle_memberships cm2
          where cm2.circle_id = cm.circle_id
            and cm2.role      = 'circle_manager'
            and cm2.status    = 'active'
       );
