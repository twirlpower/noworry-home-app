-- ============================================================================
-- NoWorry Home — Migration 005: safety checklist
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, then 005.
-- Depends on v1 helper has_circle_role.
-- Run in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Pillar 1 (Home). Item definitions live in the client (SAFETY_ITEMS); this
-- table stores per-home completion keyed by item_key. Unchecked = is_complete
-- false (no DELETE policy needed — mirrors v2's select/insert/update shape).
--   HOME_READ  = {home_owner, circle_manager, care_partner, family_member}
--   HOME_WRITE = {home_owner, circle_manager, care_partner}
-- ============================================================================

create table if not exists safety_checklist (
  id            uuid primary key default uuid_generate_v4(),
  home_id       uuid not null references homes(id) on delete cascade,
  circle_id     uuid not null references family_circles(id) on delete cascade,
  item_key      text not null,
  is_complete   boolean not null default true,
  completed_by  uuid references persons(id),
  completed_at  timestamptz not null default now(),
  notes         text,
  updated_at    timestamptz not null default now(),

  constraint unique_home_item unique (home_id, item_key)
);

create index if not exists idx_safety_home on safety_checklist(home_id);
create index if not exists idx_safety_circle on safety_checklist(circle_id);

alter table safety_checklist enable row level security;
grant select, insert, update on safety_checklist to authenticated;

drop trigger if exists set_updated_at on safety_checklist;
create trigger set_updated_at before update on safety_checklist
  for each row execute function update_updated_at();

drop policy if exists safety_select on safety_checklist;
create policy safety_select on safety_checklist for select using (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner','family_member']::circle_role[])
);

drop policy if exists safety_insert on safety_checklist;
create policy safety_insert on safety_checklist for insert with check (
  public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[])
);

drop policy if exists safety_update on safety_checklist;
create policy safety_update on safety_checklist for update
using   (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[]))
with check (public.has_circle_role(circle_id, array['home_owner','circle_manager','care_partner']::circle_role[]));
