-- ============================================================================
-- NoWorry Home — Migration 045: personal vendor list (circle_vendors)
-- Run order: ..., 043_homeowner_view_preference.sql,
--            044_owner_transfer_noworry_home.sql, then 045.
-- Depends on: family_circles + persons (schema v1.0), circle_memberships
--             (schema v1.0), circle_role enum (schema v1.0 + 014 additions),
--             has_circle_role + current_person_id (rls_policies_v1.sql).
--
-- The Personal Vendor List is a zero-operational-cost feature available to
-- every paid tier (prepared / prepared_plus / covered / complete). Stores the
-- homeowner's existing trusted contacts — HVAC tech, plumber, handyman — and
-- makes the same list visible to everyone in the family circle.
--
-- Two role gates:
--
--   1. WRITE (insert / update / soft-delete) is limited to the family-side
--      members who actually manage the home together: home_owner,
--      circle_manager, care_partner, care_coordinator. The narrative for the
--      May 26 spec is explicit that the homeowner AND the Care Partner (adult
--      child) both need to be able to add/edit; circle_manager is included
--      for parity with every other Family-write check in the codebase
--      (emergency_contacts, tasks, documents); care_coordinator joins the
--      writable set for parity with 015_care_coordinator_rls_parity.
--
--      Spec called out 'trusted_contact' as a write role — that value does
--      not exist on circle_role (the enum has 'trusted_advisor'). Trusted
--      advisors are legal/estate-planning relationships and shouldn't be
--      curating a home-vendor list, so they are excluded.
--
--   2. READ is open to every family-side member: the four WRITE roles plus
--      family_member, view_only, and trusted_advisor. service_partner and
--      helper are explicitly excluded — those roles are external service
--      providers invited into the circle for a job, and a homeowner's
--      personal vendor list (with contact info, notes, dates) is not for
--      them.
--
-- Deletion is SOFT only — we never run a DELETE against this table from the
-- app. Rows are marked deleted via UPDATE deleted_at = now(); the page filters
-- deleted_at IS NULL. This is enforced at the policy layer by simply not
-- granting a DELETE policy (RLS denies what it doesn't permit). The UPDATE
-- policy intentionally allows setting deleted_at so the soft-delete path
-- works through normal UPDATE.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

begin;

-- ── table ─────────────────────────────────────────────────────────────────
create table if not exists circle_vendors (
  id                   uuid primary key default gen_random_uuid(),
  circle_id            uuid not null references family_circles(id) on delete cascade,
  added_by_person_id   uuid references persons(id) on delete set null,
  name                 text not null check (char_length(name) between 1 and 120),
  category             text check (category in (
                         'HVAC','Plumbing','Electrical','Handyman','Landscaping',
                         'Roofing','Pest Control','Painting','Cleaning','Other'
                       )),
  phone                text,
  email                text,
  notes                text check (char_length(coalesce(notes, '')) <= 2000),
  last_used_date       date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

comment on table circle_vendors is
  'Personal vendor list scoped to a family circle. Family-side members can add/edit/soft-delete; everyone in the circle (minus service_partner / helper) can read. Soft-delete only — no row is ever physically removed by the app.';

comment on column circle_vendors.deleted_at is
  'Set to now() when a vendor is soft-deleted. App filters deleted_at IS NULL. RLS does not grant DELETE — soft delete only.';

-- Hot path is "list this circle's live vendors" — partial index keeps the
-- common query small once the deleted set grows.
create index if not exists idx_circle_vendors_circle_live
  on circle_vendors(circle_id)
  where deleted_at is null;

-- ── updated_at trigger ────────────────────────────────────────────────────
-- Standard set-updated-at trigger pattern used elsewhere in the project.
create or replace function public.tg_circle_vendors_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_circle_vendors_set_updated_at on circle_vendors;
create trigger trg_circle_vendors_set_updated_at
  before update on circle_vendors
  for each row execute function public.tg_circle_vendors_set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table circle_vendors enable row level security;

-- SELECT — every family-side role in the circle can read every live and
-- soft-deleted row (the soft-deleted ones are filtered client-side; we still
-- want them readable so an undelete UI is possible later).
drop policy if exists circle_vendors_select on circle_vendors;
create policy circle_vendors_select
  on circle_vendors for select
  using (
    public.has_circle_role(
      circle_id,
      array[
        'home_owner','circle_manager','care_partner','care_coordinator',
        'family_member','view_only','trusted_advisor'
      ]::circle_role[]
    )
  );

-- INSERT — only the family-write roles. WITH CHECK also pins added_by_person_id
-- to the caller so a writer can't attribute a row to someone else.
drop policy if exists circle_vendors_insert on circle_vendors;
create policy circle_vendors_insert
  on circle_vendors for insert
  with check (
    public.has_circle_role(
      circle_id,
      array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
    )
    and (added_by_person_id is null or added_by_person_id = public.current_person_id())
  );

-- UPDATE — same family-write roles. USING pins the row to the caller's circle
-- (so a writer in circle A can't edit circle B). WITH CHECK mirrors USING and
-- additionally prevents moving a row to a different circle via the update.
-- The policy intentionally permits both normal edits AND the soft-delete
-- UPDATE (setting deleted_at = now()) through the same rule.
drop policy if exists circle_vendors_update on circle_vendors;
create policy circle_vendors_update
  on circle_vendors for update
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

-- No DELETE policy — soft delete only. RLS denies what it doesn't grant, so
-- an actual DELETE statement from the app will be silently refused.

commit;
