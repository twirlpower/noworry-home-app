-- ============================================================================
-- NoWorry Home — Migration 035: Welcome Home Assessment schema
-- Run order: ..., 034_hometech_accounts.sql, then 035.
-- Depends on is_active_staff() (027), is_active_hometech() (034).
--
-- The home_systems table already exists from noworry_home_schema_v1.0.sql
-- with a slightly different column vocabulary. We ADD the spec's columns
-- alongside the existing ones rather than rename or migrate data —
-- assessment writes land in the new cols; member-facing display reads
-- new first, falls back to legacy.
--
-- Column mapping (assessment-side ↔ legacy-side):
--   manufacturer       ↔ brand
--   model_number       ↔ model
--   install_year       ↔ year(install_date)
--   location_notes     ↔ location_in_home
--   condition_notes    ↔ notes
--   active             ↔ is_active
--
-- The home_system_type enum is extended with the spec's granular values
-- (furnace, ac, electrical_panel, washer, dryer, refrigerator,
-- dishwasher, sump_pump, sprinkler_controller). Legacy values stay valid.
--
-- Idempotent throughout. ALTER TYPE ... ADD VALUE IF NOT EXISTS supported
-- by PG 12+.
-- ============================================================================


-- ── 1. Enum extensions ─────────────────────────────────────────────────────
alter type home_system_type add value if not exists 'furnace';
alter type home_system_type add value if not exists 'ac';
alter type home_system_type add value if not exists 'electrical_panel';
alter type home_system_type add value if not exists 'washer';
alter type home_system_type add value if not exists 'dryer';
alter type home_system_type add value if not exists 'refrigerator';
alter type home_system_type add value if not exists 'dishwasher';
alter type home_system_type add value if not exists 'sump_pump';
alter type home_system_type add value if not exists 'sprinkler_controller';


-- ── 2. home_systems — new assessment columns ───────────────────────────────
-- The legacy `name` column is NOT NULL, so the assessment-side INSERT
-- synthesizes a name from manufacturer + model. No schema change to name.

alter table home_systems
  add column if not exists manufacturer      text,
  add column if not exists model_number      text,
  add column if not exists install_year      integer,
  add column if not exists location_notes    text,
  add column if not exists condition_notes   text,
  add column if not exists photo_path        text,
  add column if not exists assessed_by       uuid references auth.users(id),
  add column if not exists assessed_at       timestamptz,
  add column if not exists assessment_method text default 'manual',
  add column if not exists filter_size       text,
  add column if not exists active            boolean default true;


-- ── 3. homes — overview answers + assessment metadata ──────────────────────
alter table homes
  add column if not exists stories               integer,
  add column if not exists hvac_system_count     integer default 1,
  add column if not exists dryer_vent_exit       text    default 'ground_wall',
  add column if not exists property_tier         text    default 'standard',
  add column if not exists assessment_complete   boolean default false,
  add column if not exists assessment_date       timestamptz,
  add column if not exists assessment_tech_id    uuid references auth.users(id);

comment on column homes.property_tier is
  'standard | enhanced — internal tier flag derived from hvac_system_count and dryer_vent_exit. Never shown to tech or member.';
comment on column homes.dryer_vent_exit is
  'ground_wall | second_floor_wall | roof | unknown';


-- ── 4. home_hazards ─────────────────────────────────────────────────────────
create table if not exists home_hazards (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  home_id         uuid not null references homes(id) on delete cascade,
  hazard_type     text not null,
  present         boolean not null,
  notes           text,
  photo_path      text,
  resolved        boolean not null default false,
  assessed_at     timestamptz default now(),
  assessed_by     uuid references auth.users(id)
);

create index if not exists idx_home_hazards_home on home_hazards(home_id);


-- ── 5. RLS — home_systems (additive — coexists with any legacy policies) ───
alter table home_systems enable row level security;

drop policy if exists "Circle members read home_systems"  on home_systems;
drop policy if exists "Staff read home_systems"           on home_systems;
drop policy if exists "HomeTech write home_systems"       on home_systems;
drop policy if exists "HomeTech update home_systems"      on home_systems;

create policy "Circle members read home_systems"
  on home_systems for select
  using (
    exists (
      select 1
        from circle_homes ch
        join circle_memberships cm on cm.circle_id = ch.circle_id
        join persons p on p.id = cm.person_id
       where ch.home_id = home_systems.home_id
         and p.auth_id = auth.uid()
         and cm.status = 'active'
    )
  );

create policy "Staff read home_systems"
  on home_systems for select
  using (
    public.is_active_staff(array['owner','staff','readonly'])
    or public.is_active_hometech()
  );

create policy "HomeTech write home_systems"
  on home_systems for insert
  with check (
    public.is_active_hometech()
    or public.is_active_staff(array['owner','staff'])
  );

create policy "HomeTech update home_systems"
  on home_systems for update
  using (
    public.is_active_hometech()
    or public.is_active_staff(array['owner','staff'])
  );


-- ── 6. RLS — home_hazards ───────────────────────────────────────────────────
alter table home_hazards enable row level security;

drop policy if exists "Circle members read hazards"  on home_hazards;
drop policy if exists "Staff read hazards"           on home_hazards;
drop policy if exists "HomeTech write hazards"       on home_hazards;

create policy "Circle members read hazards"
  on home_hazards for select
  using (
    exists (
      select 1
        from circle_homes ch
        join circle_memberships cm on cm.circle_id = ch.circle_id
        join persons p on p.id = cm.person_id
       where ch.home_id = home_hazards.home_id
         and p.auth_id = auth.uid()
         and cm.status = 'active'
    )
  );

create policy "Staff read hazards"
  on home_hazards for select
  using (
    public.is_active_staff(array['owner','staff','readonly'])
    or public.is_active_hometech()
  );

create policy "HomeTech write hazards"
  on home_hazards for insert
  with check (
    public.is_active_hometech()
    or public.is_active_staff(array['owner','staff'])
  );


-- ── 7. tech-photos storage bucket ──────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('tech-photos', 'tech-photos', false)
on conflict (id) do nothing;

drop policy if exists "HomeTech upload tech photos" on storage.objects;
drop policy if exists "Staff read tech photos"      on storage.objects;

create policy "HomeTech upload tech photos"
  on storage.objects for insert
  with check (
    bucket_id = 'tech-photos'
    and public.is_active_hometech()
  );

create policy "Staff read tech photos"
  on storage.objects for select
  using (
    bucket_id = 'tech-photos'
    and (
      public.is_active_hometech()
      or public.is_active_staff(array['owner','staff','readonly'])
    )
  );
