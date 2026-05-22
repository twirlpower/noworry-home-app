-- ============================================================================
-- NoWorry Home — Migration 024: vendor_jobs (dispatched jobs + payouts)
-- Run order: ..., 023_owner_seed_noworry_home.sql, then 024.
--
-- One row per dispatched job. Tracks what the member paid NoWorry Home
-- (member_charge), what NoWorry pays the vendor (vendor_rate), and the
-- auto-derived margin. Payout fields track whether the vendor has been
-- paid out for this job.
--
-- RLS uses the staff_accounts pattern (not the older email-hardcoded one
-- still on crm_contacts/crm_partners/vendors from migration 017).
-- Read: any active staff (owner/staff/readonly).
-- Write/Update/Delete: owner or staff only — readonly is read-only by name.
--
-- noworry_margin is a generated column (member_charge - vendor_rate),
-- always-stored so reads are cheap and the formula can't drift between
-- callers. Postgres ≥12 required.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
-- ============================================================================

create table if not exists vendor_jobs (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz default now(),

  vendor_id           uuid references vendors(id) on delete cascade not null,
  circle_id           uuid references family_circles(id) on delete set null,

  job_date            date not null,
  service_type        text not null,
  description         text,

  member_charge       numeric(8,2) not null default 0,
  vendor_rate         numeric(8,2) not null default 0,
  noworry_margin      numeric(8,2)
    generated always as (member_charge - vendor_rate) stored,

  payout_status       text not null default 'pending',
  payout_date         date,
  payout_method       text,
  payout_reference    text,

  job_status          text not null default 'completed',

  notes               text
);

create index if not exists idx_vendor_jobs_vendor on vendor_jobs(vendor_id);
create index if not exists idx_vendor_jobs_payout_status on vendor_jobs(payout_status);
create index if not exists idx_vendor_jobs_circle on vendor_jobs(circle_id);

alter table vendor_jobs enable row level security;

drop policy if exists "Staff read vendor_jobs" on vendor_jobs;
create policy "Staff read vendor_jobs"
  on vendor_jobs for select
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff','readonly')
    )
  );

drop policy if exists "Staff write vendor_jobs" on vendor_jobs;
create policy "Staff write vendor_jobs"
  on vendor_jobs for insert
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

drop policy if exists "Staff update vendor_jobs" on vendor_jobs;
create policy "Staff update vendor_jobs"
  on vendor_jobs for update
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

drop policy if exists "Staff delete vendor_jobs" on vendor_jobs;
create policy "Staff delete vendor_jobs"
  on vendor_jobs for delete
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );
