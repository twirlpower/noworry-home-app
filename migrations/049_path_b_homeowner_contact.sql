-- ============================================================================
-- NoWorry Home — Migration 049: Path B homeowner contact + pronouns
-- Run order: ..., 048_path_b_relationship_kind.sql, then 049.
-- Depends on: persons (schema v1.0 — email/phone, both nullable; email is
--             UNIQUE + CHECK valid_email), persons.gender (gender_type enum,
--             migration 038), setup_home_circle (048).
--
-- GOAL
-- Capture optional email, phone, and gender for the proxy homeowner during
-- Path B onboarding and persist them on the proxy persons row.
--
-- COLUMNS — no DDL needed.
--   • persons.email  — text, UNIQUE, nullable, CHECK valid_email (schema v1.0)
--   • persons.phone  — text, nullable (schema v1.0)
--   • persons.gender — gender_type ENUM, nullable (migration 038). It already
--     EXISTS as an enum; we do NOT add it as text. The RPC casts the incoming
--     text param to gender_type.
--
-- FUNCTION SIGNATURE CHANGE — why DROP, not a plain CREATE OR REPLACE.
-- Adding parameters changes the function's argument-type signature, so a bare
-- CREATE OR REPLACE would create a SECOND overloaded function and leave the
-- old 6-arg version in place. We DROP the old signature explicitly, then
-- create the 9-arg version. A freshly created function grants EXECUTE to
-- PUBLIC by default, so we re-apply migration 021's posture: REVOKE from
-- PUBLIC + anon, GRANT to authenticated.
--
-- Path A branch: unchanged. The three new params default to NULL; Path A
-- ignores them.
--
-- Idempotent: DROP IF EXISTS (old sig) + CREATE OR REPLACE (new sig).
-- ============================================================================


-- ── 1. Drop the old 6-arg signature (048) ─────────────────────────────────────
-- Safe: the function is only called via the onboarding RPC, not referenced by
-- any view/policy/trigger. Dropping it also drops its grants (re-added in §3).
drop function if exists public.setup_home_circle(
  text, text, jsonb, text, text, text
);


-- ── 2. Recreate setup_home_circle with homeowner contact params ───────────────
create or replace function public.setup_home_circle(
  p_setup_type         text,
  p_circle_name        text,
  p_home               jsonb,
  p_owner_first        text default null,
  p_owner_last         text default null,
  p_owner_relationship text default null,
  p_owner_email        text default null,
  p_owner_phone        text default null,
  p_owner_gender       text default null
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
    -- UNCHANGED from 046/048. relationship_kind = 'self' stamped here.
    insert into circle_memberships
      (person_id, circle_id, role, status, relationship_kind, joined_at)
    values
      (v_actor, v_circle, 'circle_manager', 'active', 'self', now());

  else
    -- Path B: actor sets up on behalf of someone else. The proxy homeowner
    -- gets their optional contact details + pronouns. nullif(trim(...), '')
    -- turns blanks into NULL so an empty email doesn't violate persons.
    -- valid_email; gender casts to the gender_type enum (NULL when blank).
    insert into persons
      (first_name, last_name, email, phone, gender, auth_status, created_by)
    values (
      p_owner_first,
      p_owner_last,
      nullif(trim(p_owner_email), ''),
      nullif(trim(p_owner_phone), ''),
      nullif(trim(p_owner_gender), '')::gender_type,
      'proxy',
      v_actor
    )
    returning id into v_owner;

    insert into circle_memberships
      (person_id, circle_id, role, status, relationship, relationship_kind, joined_at)
    values
      (v_owner, v_circle, 'home_owner', 'active', 'homeowner', 'self', now());

    -- Acting circle manager. relationship_kind = the actor's relationship TO
    -- the homeowner (048); free-text relationship stays NULL on this row.
    insert into circle_memberships
      (person_id, circle_id, role, status, relationship, relationship_kind, invited_by, joined_at)
    values
      (v_actor, v_circle, 'circle_manager', 'active', null,
       p_owner_relationship::relationship_type, v_actor, now());
  end if;

  return v_circle;
end;
$$;


-- ── 3. Restore the security posture from migration 021 ────────────────────────
-- A new function grants EXECUTE to PUBLIC by default; re-tighten to
-- authenticated-only on the new 9-arg signature.
revoke execute on function public.setup_home_circle(
  text, text, jsonb, text, text, text, text, text, text
) from public;

revoke execute on function public.setup_home_circle(
  text, text, jsonb, text, text, text, text, text, text
) from anon;

grant execute on function public.setup_home_circle(
  text, text, jsonb, text, text, text, text, text, text
) to authenticated;
