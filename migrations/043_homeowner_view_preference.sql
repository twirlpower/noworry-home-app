-- ============================================================================
-- NoWorry Home — Migration 043: homeowner view preference + welcome messages
-- Run order: ..., 042_leads_table.sql, then 043.
-- Depends on: persons (schema v1.0), family_circles (schema v1.0),
--             has_circle_role + current_person_id (rls_policies_v1.sql),
--             circle_role enum (schema v1.0).
--
-- Two related Phase 3c artifacts:
--
-- 1. persons.homeowner_view_preference
--    Per-person opt-in between the Simple homeowner dashboard
--    (Phase 3a + the May 24 "Fix Simple" pass) and the new Standard
--    dashboard that exposes the full maintenance / safety / family-
--    activity picture. Default is 'standard' so Path A self-setups
--    land on the full view; Path B onboarding can downgrade to
--    'simple' for the adult_child / grandchild / sibling cases
--    where the homeowner is being set up by someone else.
--
--    Stored on persons (not on circle_memberships) because a single
--    homeowner who belongs to multiple circles probably wants the
--    same dashboard density everywhere; per-circle granularity adds
--    complexity without a documented use case.
--
-- 2. circle_welcome_messages
--    Note the adult child writes during Path B onboarding for the
--    homeowner to see the first time they open the app. One row per
--    (circle, homeowner) — the welcome only fires once. shown_at is
--    NULL until the homeowner dismisses the overlay, after which the
--    component stops surfacing it.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── enum ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'homeowner_view_mode') then
    create type homeowner_view_mode as enum ('standard', 'simple');
  end if;
end$$;

-- ── persons.homeowner_view_preference ─────────────────────────────────────
alter table persons
  add column if not exists homeowner_view_preference homeowner_view_mode
    not null default 'standard';

comment on column persons.homeowner_view_preference is
  'Per-person homeowner dashboard density. Default standard; Path B '
  'onboarding may set simple for adult_child/grandchild/sibling.';

-- ── circle_welcome_messages ───────────────────────────────────────────────
create table if not exists circle_welcome_messages (
  id              uuid primary key default gen_random_uuid(),
  circle_id       uuid not null references family_circles(id) on delete cascade,
  from_person_id  uuid not null references persons(id),
  to_person_id    uuid not null references persons(id),
  message         text not null check (char_length(message) <= 500),
  shown_at        timestamptz,
  created_at      timestamptz not null default now(),
  unique (circle_id, to_person_id)
);

-- Hot path is "find unshown messages for this homeowner" — partial
-- index keeps the lookup tiny once most messages have been dismissed.
create index if not exists idx_welcome_messages_to_unshown
  on circle_welcome_messages(to_person_id)
  where shown_at is null;

alter table circle_welcome_messages enable row level security;

-- SELECT: the homeowner and any circle_manager in the same circle
-- can read the message. Author needs to know it was created; recipient
-- needs to see it. has_circle_role wraps the auth.uid → persons
-- resolution so we don't open-code the join.
drop policy if exists welcome_messages_select on circle_welcome_messages;
create policy welcome_messages_select
  on circle_welcome_messages for select
  using (
    public.has_circle_role(
      circle_id,
      array['home_owner', 'circle_manager']::circle_role[]
    )
  );

-- INSERT: only circle_managers can write a welcome message, and only
-- on behalf of themselves (from_person_id must be the caller). Caller-
-- identity check prevents a circle_manager from spoofing another
-- person as the sender.
drop policy if exists welcome_messages_insert on circle_welcome_messages;
create policy welcome_messages_insert
  on circle_welcome_messages for insert
  with check (
    public.has_circle_role(
      circle_id,
      array['circle_manager']::circle_role[]
    )
    and from_person_id = public.current_person_id()
  );

-- UPDATE: the recipient marks shown_at when the overlay is dismissed.
-- WITH CHECK mirrors USING so the homeowner can't transfer the row to
-- another person via the update (the to_person_id has to remain them).
drop policy if exists welcome_messages_update on circle_welcome_messages;
create policy welcome_messages_update
  on circle_welcome_messages for update
  using (to_person_id = public.current_person_id())
  with check (to_person_id = public.current_person_id());
