-- ============================================================================
-- NoWorry Home — Migration 048: Path B relationship_kind set server-side
-- Run order: ..., 047_handle_new_user_phone.sql, then 048.
-- Depends on: relationship_type enum + circle_memberships.relationship_kind
--             (038), setup_home_circle (046), current_person_id (rls v1).
--
-- PROBLEM
-- setup_home_circle's Path B (else) branch writes only the free-text
-- `relationship` column on both new circle_memberships rows. The enum
-- column `relationship_kind` (added in 038) is never set server-side, so:
--   • the proxy home_owner row's relationship_kind was always NULL, and
--   • the circle_manager row's value depended on a best-effort client
--     UPDATE in Onboarding.jsx that filtered to the actor's own row and
--     swallowed failures.
--
-- FIX
-- Set relationship_kind inside the RPC, atomically with the inserts:
--   • circle_manager row → p_owner_relationship cast to relationship_type
--     (the actor's relationship TO the homeowner: adult_child, grandchild…)
--   • proxy home_owner row → 'self' (a homeowner's relationship to their
--     own home is always self — same as the Path A owner in 046).
--
-- Free-text `relationship` column on the Path B rows:
--   • proxy home_owner → keeps 'homeowner' (unchanged from 046).
--   • circle_manager   → NULL. We have no freeform label for the manager
--     row; the structured value lives in relationship_kind. (046 wrote
--     p_owner_relationship here, but the client always passed NULL, so
--     this column was NULL in practice — we make that explicit.)
--
-- p_owner_relationship now carries the picker enum value for Path B.
-- Onboarding.jsx is updated in the same change to pass relationshipKind
-- there and to drop its post-RPC UPDATE. A NULL/absent value casts to
-- NULL (no error); the client constrains the value to relationship_type
-- labels.
--
-- Path A (the `if p_setup_type = 'self'` branch) is UNCHANGED from 046,
-- which already stamps relationship_kind = 'self' in its INSERT.
--
-- Idempotent: CREATE OR REPLACE; the backfill only touches proxy
-- home_owner rows whose relationship_kind is still NULL.
-- ============================================================================


-- ── 1. Update setup_home_circle (Path B branch only) ──────────────────────────

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
    -- UNCHANGED from migration 046. The acting user is both homeowner and
    -- circle admin; a single circle_manager row covers all home_owner
    -- permissions. relationship_kind = 'self' is stamped here.
    insert into circle_memberships
      (person_id, circle_id, role, status, relationship_kind, joined_at)
    values
      (v_actor, v_circle, 'circle_manager', 'active', 'self', now());

  else
    -- Path B: actor is setting up on behalf of someone else.
    -- Proxy homeowner — no auth account, never logs in directly. Their
    -- relationship to their own home is 'self' (mirrors the Path A owner).
    insert into persons (first_name, last_name, auth_status, created_by)
    values (p_owner_first, p_owner_last, 'proxy', v_actor)
    returning id into v_owner;

    insert into circle_memberships
      (person_id, circle_id, role, status, relationship, relationship_kind, joined_at)
    values
      (v_owner, v_circle, 'home_owner', 'active', 'homeowner', 'self', now());

    -- Acting circle manager. relationship_kind is the actor's structured
    -- relationship TO the homeowner (adult_child, grandchild, sibling…),
    -- passed in p_owner_relationship and cast to the enum. The free-text
    -- `relationship` column stays NULL on the manager row — we have no
    -- freeform label for it; the structured value lives in
    -- relationship_kind.
    insert into circle_memberships
      (person_id, circle_id, role, status, relationship, relationship_kind, invited_by, joined_at)
    values
      (v_actor, v_circle, 'circle_manager', 'active', null,
       p_owner_relationship::relationship_type, v_actor, now());
  end if;

  return v_circle;
end;
$$;

-- GRANT unchanged — same name and (text,text,jsonb,text,text,text)
-- signature as 046/021; the existing grant to 'authenticated' remains in
-- effect and does not need to be re-issued.


-- ── 2. Backfill existing Path B proxy home_owner rows ─────────────────────────
--
-- Set relationship_kind = 'self' on every proxy home_owner row that is
-- still NULL. Proxy = persons.auth_status 'proxy' (Path B owners never
-- sign in). We do NOT backfill the circle_manager rows: their correct
-- value is the actor's original picker selection, which existing records
-- don't retain anywhere, so there is no safe value to write.

update circle_memberships cm
   set relationship_kind = 'self'
  from persons p
 where cm.person_id         = p.id
   and cm.role              = 'home_owner'
   and cm.relationship_kind is null
   and p.auth_status        = 'proxy';
