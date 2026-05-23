-- ============================================================================
-- NoWorry Home — Migration 040: Trusted Advisor grants infrastructure
-- Run order: ..., 039_pillar2_role_lockdown.sql, then 040.
-- Depends on has_pillar2_access (migration 039), current_person_id +
--           has_circle_role (rls_policies_v1.sql).
--
-- Per Family Graph spec, Trusted Advisor access is "Granted Only": the
-- advisor sees nothing in a circle by default. The Circle Admin
-- explicitly grants access to specific items (this document, that
-- emergency contact). Revocation is one column flip.
--
-- This migration is kept SEPARATE from 039 so it can be rolled back
-- independently if a bug surfaces in either layer.
--
-- ─── advisor_grants ────────────────────────────────────────────────────────
-- One row per (circle, advisor, resource_type, resource_id). UNIQUE on the
-- tuple so toggling is idempotent. revoked_at NULL = active; non-NULL =
-- revoked (we keep the row for audit, never delete).
--
-- ─── advisor_access_log ────────────────────────────────────────────────────
-- Minimal audit trail. Populated by the app when an advisor opens a
-- granted resource — a trigger-driven version is a follow-up. Spec
-- mentioned this as an open question; shipping the storage so the data
-- is there when the access UX adds the logging call.
--
-- ─── Membership-end cleanup trigger ────────────────────────────────────────
-- When a trusted_advisor's membership goes non-active or is deleted, we
-- auto-revoke their grants. Prevents an orphaned advisor record from
-- still being granted to past resources.
--
-- ─── Pillar 2 SELECT extension ─────────────────────────────────────────────
-- documents_select and emergency_contacts_select gain an OR branch:
--   has_pillar2_access(circle_id)
--   OR (is_trusted_advisor(circle_id) AND advisor_has_grant(...))
-- Insert/update/delete policies are NOT extended — advisors can read
-- granted items but never write.
--
-- Idempotent throughout.
-- ============================================================================


-- ── 1. grant_resource_type enum ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'grant_resource_type') then
    create type grant_resource_type as enum (
      'document',
      'emergency_contact',
      'wish',
      'financial_account'
    );
  end if;
end$$;


-- ── 2. advisor_grants table ────────────────────────────────────────────────
create table if not exists advisor_grants (
  id                  uuid primary key default gen_random_uuid(),
  circle_id           uuid not null references family_circles(id) on delete cascade,
  advisor_person_id   uuid not null references persons(id) on delete cascade,
  resource_type       grant_resource_type not null,
  resource_id         uuid not null,
  granted_by          uuid not null references persons(id),
  granted_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  notes               text,

  unique (circle_id, advisor_person_id, resource_type, resource_id)
);

create index if not exists idx_advisor_grants_advisor
  on advisor_grants(advisor_person_id) where revoked_at is null;
create index if not exists idx_advisor_grants_resource
  on advisor_grants(resource_type, resource_id) where revoked_at is null;
create index if not exists idx_advisor_grants_circle
  on advisor_grants(circle_id);

comment on table advisor_grants is
  'Per-resource grants for trusted_advisor circle members. The advisor sees nothing by default; rows here carve out access to specific documents / emergency contacts / wishes / financial accounts. revoked_at NULL = active.';


-- ── 3. Helpers ─────────────────────────────────────────────────────────────

-- True when the caller is an active trusted_advisor in the given circle.
create or replace function public.is_trusted_advisor(p_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_circle_role(
    p_circle_id,
    array['trusted_advisor']::circle_role[]
  )
$$;

revoke execute on function public.is_trusted_advisor(uuid) from public;
grant  execute on function public.is_trusted_advisor(uuid) to authenticated;

-- True when the caller has a non-revoked grant for the given resource.
-- Uses current_person_id() to look up the calling user's persons.id —
-- advisor_grants.advisor_person_id references persons.id, NOT auth.uid().
create or replace function public.advisor_has_grant(
  p_resource_type grant_resource_type,
  p_resource_id   uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from advisor_grants
    where advisor_person_id = public.current_person_id()
      and resource_type    = p_resource_type
      and resource_id      = p_resource_id
      and revoked_at is null
  )
$$;

revoke execute on function public.advisor_has_grant(grant_resource_type, uuid) from public;
grant  execute on function public.advisor_has_grant(grant_resource_type, uuid) to authenticated;


-- ── 4. RLS on advisor_grants ───────────────────────────────────────────────
alter table advisor_grants enable row level security;

drop policy if exists advisor_grants_admin_select on advisor_grants;
drop policy if exists advisor_grants_self_select  on advisor_grants;
drop policy if exists advisor_grants_admin_write  on advisor_grants;
drop policy if exists advisor_grants_admin_update on advisor_grants;

-- Circle Admins (home_owner / circle_manager) see all grants in their
-- circles — needed for the grant-management UI.
create policy advisor_grants_admin_select on advisor_grants for select
  using (
    public.has_circle_role(
      circle_id,
      array['home_owner','circle_manager']::circle_role[]
    )
  );

-- The advisor sees their own non-revoked grants — needed so the app can
-- show them what they've been granted access to.
create policy advisor_grants_self_select on advisor_grants for select
  using (
    advisor_person_id = public.current_person_id()
    and revoked_at is null
  );

-- Only Circle Admins can create grants.
create policy advisor_grants_admin_write on advisor_grants for insert
  with check (
    public.has_circle_role(
      circle_id,
      array['home_owner','circle_manager']::circle_role[]
    )
  );

-- Only Circle Admins can revoke (update revoked_at).
create policy advisor_grants_admin_update on advisor_grants for update
  using (
    public.has_circle_role(
      circle_id,
      array['home_owner','circle_manager']::circle_role[]
    )
  )
  with check (
    public.has_circle_role(
      circle_id,
      array['home_owner','circle_manager']::circle_role[]
    )
  );


-- ── 5. Extend Pillar 2 SELECT policies ─────────────────────────────────────
-- Replace the policies from migration 039 with versions that also let
-- trusted_advisors through when they have a non-revoked grant.

drop policy if exists documents_select on documents;
create policy documents_select on documents for select
  using (
    public.has_pillar2_access(circle_id)
    or (
      public.is_trusted_advisor(circle_id)
      and public.advisor_has_grant('document'::grant_resource_type, id)
    )
  );

drop policy if exists emergency_contacts_select on emergency_contacts;
create policy emergency_contacts_select on emergency_contacts for select
  using (
    public.has_pillar2_access(circle_id)
    or (
      public.is_trusted_advisor(circle_id)
      and public.advisor_has_grant('emergency_contact'::grant_resource_type, id)
    )
  );


-- ── 6. advisor_access_log ──────────────────────────────────────────────────
create table if not exists advisor_access_log (
  id              uuid primary key default gen_random_uuid(),
  grant_id        uuid not null references advisor_grants(id) on delete cascade,
  accessed_at     timestamptz not null default now(),
  resource_type   grant_resource_type not null,
  resource_id     uuid not null
);

create index if not exists idx_advisor_access_log_grant
  on advisor_access_log(grant_id);
create index if not exists idx_advisor_access_log_when
  on advisor_access_log(accessed_at desc);

alter table advisor_access_log enable row level security;

drop policy if exists advisor_access_log_select on advisor_access_log;
drop policy if exists advisor_access_log_insert on advisor_access_log;

-- Circle Admins can read the log for grants in their circles. Joins
-- through advisor_grants → circle_memberships to scope by circle.
create policy advisor_access_log_select on advisor_access_log for select
  using (
    exists (
      select 1
        from advisor_grants g
       where g.id = advisor_access_log.grant_id
         and public.has_circle_role(
               g.circle_id,
               array['home_owner','circle_manager']::circle_role[]
             )
    )
  );

-- Inserts happen from the app when an advisor opens a granted resource.
-- The advisor themselves writes the log row (with their own grant_id),
-- so the policy gates on the grant belonging to the calling user.
create policy advisor_access_log_insert on advisor_access_log for insert
  with check (
    exists (
      select 1
        from advisor_grants g
       where g.id = advisor_access_log.grant_id
         and g.advisor_person_id = public.current_person_id()
         and g.revoked_at is null
    )
  );


-- ── 7. Auto-revoke trigger ─────────────────────────────────────────────────
-- When a trusted_advisor's membership goes non-active OR is deleted, sweep
-- their grants. Triggers on AFTER UPDATE (status changes) and AFTER DELETE
-- (membership removed entirely).

create or replace function public.revoke_advisor_grants_on_membership_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- OLD is the row pre-change; on DELETE this is the deleted row, on
  -- UPDATE this is the prior state. Either way, OLD.role + OLD.person_id
  -- + OLD.circle_id are the keys we need to scope the revoke.
  if tg_op = 'DELETE' or (old.role = 'trusted_advisor' and (new.status is null or new.status != 'active')) then
    if old.role = 'trusted_advisor' then
      update advisor_grants
         set revoked_at = now()
       where advisor_person_id = old.person_id
         and circle_id         = old.circle_id
         and revoked_at is null;
    end if;
  end if;
  return null;  -- AFTER trigger return value is ignored
end;
$$;

drop trigger if exists revoke_grants_on_membership_change on circle_memberships;
create trigger revoke_grants_on_membership_change
  after update or delete on circle_memberships
  for each row
  execute function public.revoke_advisor_grants_on_membership_end();
