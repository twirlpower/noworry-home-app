-- ============================================================================
-- NoWorry Home — RLS Policies v1 (bootstrap subset)
-- Covers 5 tables the app currently touches:
--   persons, homes, circle_homes, family_circles, circle_memberships
-- Goal: make signup -> onboarding -> dashboard work end-to-end.
-- Run AFTER noworry_home_schema_v1.0.sql, in the Supabase SQL Editor.
--
-- Permission model — from the Family Graph Spec permission matrix:
--   Role            Home        Plan        Family       Continuity
--   Home Owner      Full        Full        Full         Full
--   Circle Manager  Full        Full        Full         Full
--   Care Partner    Full        Read        Full         Read
--   Service Partner Tasks Only  BLOCKED     Tasks Only    None
--   Helper          Assigned    None        Assigned      None
--   Family Member   Read        None        Read         None
--   Trusted Advisor None        Granted     None         Granted
--
-- Pillar -> table mapping for this subset:
--   homes, circle_homes      = Pillar 1 (Home)
--   circle_memberships       = Pillar 3 (Family)
--   family_circles           = membership container (any active member may read)
--   persons                  = identity (own row + roster gated by Family-read)
--
-- Derived role sets (Service Partner / Helper reach Home & Family only via the
-- tasks table — not these records — so they are excluded here; Trusted Advisor
-- has no Home/Family access):
--   HOME_READ   = FAMILY_READ  = {home_owner, circle_manager, care_partner, family_member}
--   HOME_WRITE  = FAMILY_WRITE = {home_owner, circle_manager, care_partner}
-- ============================================================================

-- ── HELPER FUNCTIONS ────────────────────────────────────────────────────────
-- SECURITY DEFINER so they bypass RLS internally → no recursive policy eval.

create or replace function public.current_person_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from persons where auth_id = auth.uid()
$$;

create or replace function public.is_active_member(p_circle_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circle_memberships
    where circle_id = p_circle_id
      and person_id = public.current_person_id()
      and status = 'active'
  )
$$;

create or replace function public.has_circle_role(p_circle_id uuid, p_roles circle_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circle_memberships
    where circle_id = p_circle_id
      and person_id = public.current_person_id()
      and status = 'active'
      and role = any(p_roles)
  )
$$;

-- A person is visible to a viewer who shares a circle with them AND holds a
-- Family-read role in that shared circle (matches Family pillar read gating).
create or replace function public.can_view_person(p_person_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from circle_memberships me
    join circle_memberships them on them.circle_id = me.circle_id
    where me.person_id = public.current_person_id()
      and me.status = 'active'
      and me.role = any (array['home_owner','circle_manager','care_partner','family_member']::circle_role[])
      and them.person_id = p_person_id
      and them.status = 'active'
  )
$$;

grant execute on function
  public.current_person_id(),
  public.is_active_member(uuid),
  public.has_circle_role(uuid, circle_role[]),
  public.can_view_person(uuid)
to authenticated;

-- ── persons ROW ON SIGNUP (trigger, not client insert) ──────────────────────
-- Removes the RLS-timing fragility where the persons insert raced the auth
-- session. App passes first/last name via signUp options.data (user_metadata).

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.persons (auth_id, email, first_name, last_name, auth_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    'active'
  )
  on conflict (auth_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── ATOMIC ONBOARDING RPC ───────────────────────────────────────────────────
-- Solves the RLS bootstrap chicken-and-egg (can't SELECT a circle you have no
-- membership in yet) and makes onboarding transactional. Returns circle_id.

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
  values (p_circle_name, 'home_base')
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

-- ── POLICIES ────────────────────────────────────────────────────────────────
-- RLS is already enabled on every table by the v1.0 schema.

-- persons -------------------------------------------------------------------
create policy persons_select on persons for select using (
  auth_id = auth.uid()
  or created_by = public.current_person_id()
  or public.can_view_person(persons.id)
);

create policy persons_insert on persons for insert with check (
  auth_id = auth.uid()
  or (auth_id is null and created_by = public.current_person_id())
);

create policy persons_update on persons for update
using   (auth_id = auth.uid() or created_by = public.current_person_id())
with check (auth_id = auth.uid() or created_by = public.current_person_id());

-- family_circles ------------------------------------------------------------
-- Container: any active member may read (entry point even for Trusted Advisor /
-- Service Partner). Writes = Family-write roles. Created only via the RPC.
create policy circles_select on family_circles for select using (
  public.is_active_member(id)
);

create policy circles_update on family_circles for update
using   (public.has_circle_role(id, array['home_owner','circle_manager','care_partner']::circle_role[]))
with check (public.has_circle_role(id, array['home_owner','circle_manager','care_partner']::circle_role[]));

-- circle_memberships (Pillar 3: Family) -------------------------------------
-- Always see your own row; Family-read roles see the full roster; Family-write
-- roles manage members.
create policy memberships_select on circle_memberships for select using (
  person_id = public.current_person_id()
  or public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','family_member']::circle_role[])
);

create policy memberships_insert on circle_memberships for insert with check (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[])
);

create policy memberships_update on circle_memberships for update
using   (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[]))
with check (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[]));

-- circle_homes (Pillar 1: Home) ---------------------------------------------
create policy circle_homes_select on circle_homes for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','family_member']::circle_role[])
);

create policy circle_homes_update on circle_homes for update
using   (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[]))
with check (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[]));

-- homes (Pillar 1: Home) ----------------------------------------------------
-- Permanent records reached through circle_homes. Home-read roles read;
-- Home-write roles update.
create policy homes_select on homes for select using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = homes.id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner','family_member']::circle_role[])
  )
);

create policy homes_update on homes for update
using (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = homes.id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner']::circle_role[])
  )
)
with check (
  exists (
    select 1 from circle_homes ch
    where ch.home_id = homes.id and ch.status = 'active'
      and public.has_circle_role(ch.circle_id, array['home_owner','circle_manager','care_partner']::circle_role[])
  )
);

-- ============================================================================
-- NOT YET COVERED (no client policy → deny-all until expanded with the rest of
-- the permission matrix): home_systems, maintenance_events, documents, tasks,
-- succession_configs, family_groups, family_group_circles, home_transfers,
-- notifications, notification_preferences, notes, emergency_contacts,
-- audit_log, maintenance_templates, scheduled_maintenance.
-- Note: Service Partner / Helper Home & Family access is "Tasks Only" — it
-- arrives with the tasks table policies, not here.
-- ============================================================================
