-- ============================================================================
-- NoWorry Home — Database Schema v1.0
-- Based on Family Graph Specification v1.0 (May 2026)
-- Target: Supabase (PostgreSQL 15+)
-- Run this in Supabase SQL Editor on a fresh project
-- ============================================================================

-- ── EXTENSIONS ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── ENUMS ───────────────────────────────────────────────────────────────────

create type auth_status as enum ('active', 'proxy', 'claimed', 'deactivated');

create type circle_role as enum (
  'home_owner',
  'circle_manager',
  'care_partner',
  'service_partner',
  'helper',
  'family_member',
  'trusted_advisor'
);

create type membership_status as enum ('active', 'invited', 'removed', 'left');

create type circle_home_status as enum ('active', 'archived', 'transferring');

create type subscription_tier as enum ('aware', 'prepared', 'covered', 'complete');

create type pillar as enum ('the_home', 'the_plan', 'the_family', 'continuity');

create type task_status as enum ('open', 'assigned', 'in_progress', 'complete', 'cancelled');

create type task_priority as enum ('low', 'medium', 'high', 'urgent');

create type succession_type as enum ('voluntary', 'incapacity', 'death', 'emergency');

create type succession_status as enum ('configured', 'requested', 'confirmed', 'completed', 'expired');

create type transfer_type as enum ('cooperative', 'ownership_based');

create type transfer_status as enum ('requested', 'verified', 'completed', 'rejected');

create type notification_channel as enum ('in_app', 'email', 'sms', 'push');

create type home_system_type as enum (
  'hvac', 'plumbing', 'electrical', 'water_heater', 'roof',
  'foundation', 'appliance', 'security', 'garage', 'other'
);

create type maintenance_event_type as enum (
  'inspection', 'repair', 'replacement', 'installation',
  'cleaning', 'seasonal', 'emergency', 'other'
);

create type document_type as enum (
  'will', 'poa_financial', 'poa_medical', 'trust', 'deed',
  'insurance', 'medical', 'tax', 'other'
);


-- ── 1. PERSONS ──────────────────────────────────────────────────────────────
-- One login, one identity, exists forever.
-- Proxy accounts have no auth — managed by a Circle Manager.

create table persons (
  id            uuid primary key default uuid_generate_v4(),
  auth_id       uuid unique,                          -- links to supabase auth.users (null for proxy)
  auth_status   auth_status not null default 'active',
  email         text unique,                          -- null for proxy accounts
  phone         text,
  first_name    text not null,
  last_name     text not null,
  date_of_birth date,
  avatar_url    text,
  timezone      text default 'America/Denver',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references persons(id),          -- who created this profile (for proxy accounts)

  constraint valid_email check (email is null or email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

create index idx_persons_email on persons(email);
create index idx_persons_auth_id on persons(auth_id);
create index idx_persons_auth_status on persons(auth_status);

comment on table persons is 'Core person entity. One per human. Supports proxy accounts for non-tech homeowners.';
comment on column persons.auth_status is 'active = has login, proxy = managed by someone else, claimed = proxy that activated, deactivated = account closed';


-- ── 2. HOMES ────────────────────────────────────────────────────────────────
-- One address, permanent record. Outlives any owner.

create table homes (
  id            uuid primary key default uuid_generate_v4(),
  address_line1 text not null,
  address_line2 text,
  city          text not null,
  state         text not null,
  zip           text not null,
  country       text not null default 'US',
  year_built    integer,
  square_feet   integer,
  lot_size_sqft integer,
  stories       integer,
  bedrooms      integer,
  bathrooms     numeric(3,1),
  garage_type   text,                                 -- attached, detached, none
  basement      boolean default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint valid_zip check (zip ~* '^\d{5}(-\d{4})?$'),
  constraint valid_year check (year_built is null or (year_built >= 1800 and year_built <= 2030))
);

create index idx_homes_zip on homes(zip);
create index idx_homes_city_state on homes(city, state);

comment on table homes is 'Permanent home record. Persists across ownership changes. Carfax-for-homes model.';


-- ── 3. HOME SYSTEMS ─────────────────────────────────────────────────────────
-- Every mechanical/structural system in the home.

create table home_systems (
  id              uuid primary key default uuid_generate_v4(),
  home_id         uuid not null references homes(id) on delete cascade,
  system_type     home_system_type not null,
  name            text not null,                      -- e.g. "Lennox Furnace", "Bradford White 50gal"
  brand           text,
  model           text,
  serial_number   text,
  install_date    date,
  expected_life_years integer,
  location_in_home text,                              -- e.g. "basement", "garage", "utility closet"
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_home_systems_home on home_systems(home_id);
create index idx_home_systems_type on home_systems(system_type);

comment on table home_systems is 'Every tracked system/appliance in a home. Tied to the home, not the circle.';


-- ── 4. FAMILY CIRCLES ───────────────────────────────────────────────────────
-- The coordination unit. Manages people and homes.

create table family_circles (
  id                uuid primary key default uuid_generate_v4(),
  name              text not null,                    -- e.g. "Margaret's Home Circle"
  subscription_tier subscription_tier not null default 'aware',
  billing_person_id uuid references persons(id),      -- who pays (null for free tier)
  family_group_id   uuid,                             -- linked for family pricing (FK added after family_groups table)
  is_archived       boolean not null default false,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table family_circles is 'Coordination unit. Manages members, homes, tasks, and documents. Fully isolated from other circles.';


-- ── 5. CIRCLE MEMBERSHIPS ───────────────────────────────────────────────────
-- Connects Person ↔ Circle with a Role.

create table circle_memberships (
  id            uuid primary key default uuid_generate_v4(),
  person_id     uuid not null references persons(id),
  circle_id     uuid not null references family_circles(id) on delete cascade,
  role          circle_role not null,
  status        membership_status not null default 'invited',
  relationship  text,                                 -- "daughter", "son", "spouse", "aide", "attorney"
  invited_by    uuid references persons(id),
  joined_at     timestamptz,
  removed_at    timestamptz,
  removed_by    uuid references persons(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint unique_person_circle unique (person_id, circle_id)
);

create index idx_memberships_circle on circle_memberships(circle_id);
create index idx_memberships_person on circle_memberships(person_id);
create index idx_memberships_role on circle_memberships(role);
create index idx_memberships_status on circle_memberships(status);

comment on table circle_memberships is 'Joins persons to circles with roles. One row per person per circle. Same person can be in multiple circles with different roles.';


-- ── 6. CIRCLE HOMES ─────────────────────────────────────────────────────────
-- Connects Home ↔ Circle.

create table circle_homes (
  id            uuid primary key default uuid_generate_v4(),
  circle_id     uuid not null references family_circles(id) on delete cascade,
  home_id       uuid not null references homes(id),
  status        circle_home_status not null default 'active',
  is_primary    boolean not null default true,        -- primary home in multi-home circles
  added_at      timestamptz not null default now(),
  archived_at   timestamptz,

  constraint unique_circle_home unique (circle_id, home_id)
);

create index idx_circle_homes_circle on circle_homes(circle_id);
create index idx_circle_homes_home on circle_homes(home_id);

comment on table circle_homes is 'Connects homes to circles. A home belongs to one active circle at a time. History persists on the home entity.';


-- ── 7. MAINTENANCE EVENTS ───────────────────────────────────────────────────
-- Every vendor visit, repair, inspection. Belongs to the HOME, not the circle.

create table maintenance_events (
  id              uuid primary key default uuid_generate_v4(),
  home_id         uuid not null references homes(id),
  home_system_id  uuid references home_systems(id),
  event_type      maintenance_event_type not null,
  title           text not null,
  description     text,
  vendor_name     text,
  vendor_phone    text,
  cost            numeric(10,2),
  scheduled_date  date,
  completed_date  date,
  is_completed    boolean not null default false,
  notes           text,
  created_by      uuid references persons(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_maint_events_home on maintenance_events(home_id);
create index idx_maint_events_system on maintenance_events(home_system_id);
create index idx_maint_events_date on maintenance_events(scheduled_date);
create index idx_maint_events_type on maintenance_events(event_type);

comment on table maintenance_events is 'Permanent maintenance record. Tied to the home, not the circle. Transfers with ownership.';


-- ── 8. DOCUMENTS ────────────────────────────────────────────────────────────
-- Pillar 2: The Plan. Belongs to the CIRCLE (private family data).

create table documents (
  id              uuid primary key default uuid_generate_v4(),
  circle_id       uuid not null references family_circles(id) on delete cascade,
  pillar          pillar not null default 'the_plan',
  document_type   document_type not null,
  title           text not null,
  description     text,
  file_path       text,                               -- Supabase storage path
  file_size_bytes bigint,
  mime_type       text,
  uploaded_by     uuid not null references persons(id),
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_documents_circle on documents(circle_id);
create index idx_documents_pillar on documents(pillar);
create index idx_documents_type on documents(document_type);

comment on table documents is 'Family documents (will, POA, insurance, etc). Belongs to the circle, NOT the home. Does not transfer on sale.';


-- ── 9. TASKS ────────────────────────────────────────────────────────────────
-- Shared task management across the circle.

create table tasks (
  id              uuid primary key default uuid_generate_v4(),
  circle_id       uuid not null references family_circles(id) on delete cascade,
  home_id         uuid references homes(id),
  pillar          pillar not null default 'the_home',
  title           text not null,
  description     text,
  assigned_to     uuid references persons(id),
  created_by      uuid not null references persons(id),
  status          task_status not null default 'open',
  priority        task_priority not null default 'medium',
  due_date        date,
  completed_at    timestamptz,
  completed_by    uuid references persons(id),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_tasks_circle on tasks(circle_id);
create index idx_tasks_assigned on tasks(assigned_to);
create index idx_tasks_status on tasks(status);
create index idx_tasks_due on tasks(due_date);
create index idx_tasks_home on tasks(home_id);

comment on table tasks is 'Shared task management. Can be assigned to any circle member including Helpers and Service Partners.';


-- ── 10. SUCCESSION CONFIG ───────────────────────────────────────────────────
-- Pre-configured succession plans for Pillar 4: Continuity.

create table succession_configs (
  id                  uuid primary key default uuid_generate_v4(),
  circle_id           uuid not null references family_circles(id) on delete cascade,
  successor_person_id uuid not null references persons(id),
  confirmer_person_id uuid references persons(id),    -- second person who must confirm
  succession_type     succession_type not null,
  status              succession_status not null default 'configured',
  requested_at        timestamptz,
  confirmed_at        timestamptz,
  completed_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_succession_circle on succession_configs(circle_id);

comment on table succession_configs is 'Pre-configured succession plans. Defines who takes over admin/control and who confirms the transfer.';


-- ── 11. FAMILY GROUPS ───────────────────────────────────────────────────────
-- Billing-only entity linking multiple circles for family pricing.
-- NO data bridge. Privacy isolation is absolute.

create table family_groups (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,                      -- e.g. "The Johnson Family"
  payer_person_id uuid references persons(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table family_group_circles (
  id              uuid primary key default uuid_generate_v4(),
  family_group_id uuid not null references family_groups(id) on delete cascade,
  circle_id       uuid not null references family_circles(id),
  joined_at       timestamptz not null default now(),

  constraint unique_group_circle unique (family_group_id, circle_id)
);

create index idx_fg_circles_group on family_group_circles(family_group_id);
create index idx_fg_circles_circle on family_group_circles(circle_id);

-- Now add the FK on family_circles
alter table family_circles
  add constraint fk_family_group
  foreign key (family_group_id) references family_groups(id);

comment on table family_groups is 'Billing-only entity. Links circles for family pricing. Zero data sharing between circles.';


-- ── 12. HOME TRANSFERS ──────────────────────────────────────────────────────
-- Tracks transfer of home records on property sale.

create table home_transfers (
  id                uuid primary key default uuid_generate_v4(),
  home_id           uuid not null references homes(id),
  from_circle_id    uuid references family_circles(id),
  to_circle_id      uuid references family_circles(id),
  transfer_type     transfer_type not null,
  status            transfer_status not null default 'requested',
  proof_file_path   text,                             -- uploaded closing docs
  requested_by      uuid not null references persons(id),
  approved_by       uuid references persons(id),
  verified_at       timestamptz,
  completed_at      timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_transfers_home on home_transfers(home_id);
create index idx_transfers_status on home_transfers(status);

comment on table home_transfers is 'Tracks home record transfers on property sale. Two paths: cooperative (admin approves) and ownership-based (proof of sale).';


-- ── 13. NOTIFICATIONS ───────────────────────────────────────────────────────

create table notifications (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references persons(id),
  circle_id       uuid references family_circles(id),
  channel         notification_channel not null default 'in_app',
  title           text not null,
  body            text,
  action_url      text,
  is_read         boolean not null default false,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index idx_notifications_person on notifications(person_id);
create index idx_notifications_circle on notifications(circle_id);
create index idx_notifications_unread on notifications(person_id, is_read) where is_read = false;

comment on table notifications is 'In-app and push notifications. Scoped to circle for isolation.';


-- ── 14. NOTIFICATION PREFERENCES ────────────────────────────────────────────

create table notification_preferences (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references persons(id),
  circle_id       uuid not null references family_circles(id),
  channel         notification_channel not null default 'email',
  task_alerts     boolean not null default true,
  maintenance_alerts boolean not null default true,
  home_health_alerts boolean not null default true,
  digest_only     boolean not null default false,
  muted           boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint unique_pref_person_circle_channel unique (person_id, circle_id, channel)
);

comment on table notification_preferences is 'Per-circle per-channel notification preferences. Enables muting one circle while staying active in another.';


-- ── 15. NOTES ───────────────────────────────────────────────────────────────
-- Family communication within a circle.

create table notes (
  id              uuid primary key default uuid_generate_v4(),
  circle_id       uuid not null references family_circles(id) on delete cascade,
  home_id         uuid references homes(id),
  author_id       uuid not null references persons(id),
  pillar          pillar,
  content         text not null,
  is_pinned       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_notes_circle on notes(circle_id);
create index idx_notes_home on notes(home_id);
create index idx_notes_author on notes(author_id);

comment on table notes is 'Family notes and updates within a circle. Visible to members per their role permissions.';


-- ── 16. EMERGENCY CONTACTS ──────────────────────────────────────────────────

create table emergency_contacts (
  id              uuid primary key default uuid_generate_v4(),
  circle_id       uuid not null references family_circles(id) on delete cascade,
  name            text not null,
  relationship    text,
  phone           text,
  email           text,
  is_primary      boolean not null default false,
  priority_order  integer not null default 1,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_emergency_circle on emergency_contacts(circle_id);

comment on table emergency_contacts is 'Emergency contact list for the circle. Ordered by priority.';


-- ── 17. AUDIT LOG ───────────────────────────────────────────────────────────
-- Every significant action is logged for transparency and compliance.

create table audit_log (
  id              uuid primary key default uuid_generate_v4(),
  circle_id       uuid references family_circles(id),
  person_id       uuid references persons(id),
  action          text not null,                      -- 'member.invited', 'role.changed', 'document.uploaded', etc.
  target_type     text,                               -- 'person', 'home', 'document', 'task', etc.
  target_id       uuid,
  metadata        jsonb,                              -- additional context
  ip_address      inet,
  created_at      timestamptz not null default now()
);

create index idx_audit_circle on audit_log(circle_id);
create index idx_audit_person on audit_log(person_id);
create index idx_audit_action on audit_log(action);
create index idx_audit_created on audit_log(created_at);

comment on table audit_log is 'Immutable audit trail. Every role change, access grant, document upload, and succession event is logged.';


-- ── 18. MAINTENANCE SCHEDULE TEMPLATES ──────────────────────────────────────
-- Pre-built seasonal maintenance reminders.

create table maintenance_templates (
  id              uuid primary key default uuid_generate_v4(),
  system_type     home_system_type,
  title           text not null,
  description     text,
  frequency_months integer not null,                  -- how often (3 = quarterly, 12 = annual)
  season          text,                               -- 'spring', 'summer', 'fall', 'winter', null = any
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table maintenance_templates is 'System-wide maintenance schedule templates. Used to auto-generate tasks for home systems.';


-- ── 19. SCHEDULED MAINTENANCE ───────────────────────────────────────────────
-- Auto-generated from templates + home systems.

create table scheduled_maintenance (
  id                  uuid primary key default uuid_generate_v4(),
  home_id             uuid not null references homes(id),
  home_system_id      uuid references home_systems(id),
  template_id         uuid references maintenance_templates(id),
  circle_id           uuid not null references family_circles(id),
  title               text not null,
  description         text,
  due_date            date not null,
  is_completed        boolean not null default false,
  completed_at        timestamptz,
  completed_by        uuid references persons(id),
  linked_task_id      uuid references tasks(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_sched_maint_home on scheduled_maintenance(home_id);
create index idx_sched_maint_circle on scheduled_maintenance(circle_id);
create index idx_sched_maint_due on scheduled_maintenance(due_date);

comment on table scheduled_maintenance is 'Auto-generated maintenance reminders based on templates and home system data.';


-- ── AUTO-UPDATE TIMESTAMPS ──────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply to all tables with updated_at
do $$
declare
  tbl text;
begin
  for tbl in
    select table_name from information_schema.columns
    where column_name = 'updated_at'
    and table_schema = 'public'
  loop
    execute format(
      'create trigger set_updated_at before update on %I for each row execute function update_updated_at()',
      tbl
    );
  end loop;
end;
$$;


-- ── ROW LEVEL SECURITY (RLS) FOUNDATIONS ─────────────────────────────────────
-- Enable RLS on all tables. Policies will be added per-role in a separate migration.

alter table persons enable row level security;
alter table homes enable row level security;
alter table family_circles enable row level security;
alter table circle_memberships enable row level security;
alter table circle_homes enable row level security;
alter table home_systems enable row level security;
alter table maintenance_events enable row level security;
alter table documents enable row level security;
alter table tasks enable row level security;
alter table succession_configs enable row level security;
alter table family_groups enable row level security;
alter table family_group_circles enable row level security;
alter table home_transfers enable row level security;
alter table notifications enable row level security;
alter table notification_preferences enable row level security;
alter table notes enable row level security;
alter table emergency_contacts enable row level security;
alter table audit_log enable row level security;
alter table scheduled_maintenance enable row level security;

comment on schema public is 'NoWorry Home v1.0 — Family Graph Schema. See Family_Graph_Spec_v1.0 for architecture decisions.';


-- ============================================================================
-- SCHEMA COMPLETE
-- Next steps:
-- 1. RLS policies (separate migration based on role permissions matrix)
-- 2. Supabase Auth configuration
-- 3. Storage buckets for documents and proof-of-ownership files
-- 4. Edge functions for succession workflows and notification routing
-- 5. Seed data for maintenance templates
-- ============================================================================
