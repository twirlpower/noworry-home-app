-- ============================================================================
-- NoWorry Home — Migration 017: Founder Admin CRM tables
-- Run order: ..., 016_view_only_rls_read_parity.sql, then 017.
--
-- Scope: three founder-only tables backing /admin/crm.
--   crm_contacts  — member pipeline (lead → covered/complete) + MRR tracking
--   crm_partners  — referral partners (Medicare agents, attorneys, etc.)
--   vendors       — trade vendors dispatched for member jobs
--
-- All three have a single RLS policy: full access if the JWT's email matches
-- tye@oakraa.com. Everyone else gets nothing (no SELECT, no INSERT, etc.).
-- This is deliberately hard-coded to the founder address — there is no
-- "admin role" concept anywhere else in the schema yet, and adding one just
-- for three private tables would be over-engineering.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE.
-- ============================================================================

-- ── crm_contacts ────────────────────────────────────────────────────────────
create table if not exists crm_contacts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  name          text not null,
  phone         text,
  email         text,
  source        text,
  tier          text default 'lead',
  date_added    date default current_date,
  converted_at  timestamptz,
  mrr           numeric(8,2) default 0,
  notes         text,
  next_action   text,
  circle_id     uuid references family_circles(id) on delete set null
);

alter table crm_contacts enable row level security;

drop policy if exists "Founder full access crm_contacts" on crm_contacts;
create policy "Founder full access crm_contacts"
  on crm_contacts for all
  using (auth.jwt() ->> 'email' = 'tye@oakraa.com')
  with check (auth.jwt() ->> 'email' = 'tye@oakraa.com');

-- ── crm_partners ────────────────────────────────────────────────────────────
create table if not exists crm_partners (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz default now(),
  name              text not null,
  organization      text,
  type              text,
  date_met          date,
  last_contact      date,
  members_referred  integer default 0,
  active            boolean default true,
  notes             text,
  next_step         text
);

alter table crm_partners enable row level security;

drop policy if exists "Founder full access crm_partners" on crm_partners;
create policy "Founder full access crm_partners"
  on crm_partners for all
  using (auth.jwt() ->> 'email' = 'tye@oakraa.com')
  with check (auth.jwt() ->> 'email' = 'tye@oakraa.com');

-- ── vendors ─────────────────────────────────────────────────────────────────
create table if not exists vendors (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz default now(),
  name                  text not null,
  trade                 text,
  contact_name          text,
  phone                 text,
  email                 text,
  status                text default 'prospect',
  tech_tier             text default 'onboarding',
  founding_partner      boolean default false,
  agreement_signed_at   date,
  activation_fee_paid   boolean default false,
  jobs_dispatched       integer default 0,
  jobs_completed        integer default 0,
  guarantee_claims      integer default 0,
  notes                 text,
  territory             text default 'aurora_denver_metro'
);

alter table vendors enable row level security;

drop policy if exists "Founder full access vendors" on vendors;
create policy "Founder full access vendors"
  on vendors for all
  using (auth.jwt() ->> 'email' = 'tye@oakraa.com')
  with check (auth.jwt() ->> 'email' = 'tye@oakraa.com');
