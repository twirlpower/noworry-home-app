-- ============================================================================
-- NoWorry Home — Migration 025: realign Admin CRM RLS to staff_accounts
-- Run order: ..., 024_vendor_jobs.sql, then 025.
--
-- Migration 017 created three admin-CRM tables (crm_contacts, crm_partners,
-- vendors) gated by a single hardcoded check:
--     auth.jwt() ->> 'email' = 'tye@oakraa.com'
-- That predicate matches one address only. The current owner signs in as
-- tye@noworry-home.com and was being denied at the RLS layer despite a
-- valid staff_accounts row.
--
-- This migration drops those three "Founder full access X" policies and
-- replaces them with the same staff_accounts pattern used by vendor_jobs
-- (migration 024):
--
--   SELECT  — owner / staff / readonly  (all active staff can read)
--   INSERT  — owner / staff             (readonly cannot write)
--   UPDATE  — owner / staff
--   DELETE  — owner / staff
--
-- This also means new owners or staff added via staff_accounts immediately
-- get the right access without a code or migration change.
--
-- Idempotent: DROP POLICY IF EXISTS for both the old and the new names
-- before recreating, so partial re-runs land cleanly.
-- ============================================================================

-- ── crm_contacts ────────────────────────────────────────────────────────────

drop policy if exists "Founder full access crm_contacts" on crm_contacts;
drop policy if exists "Staff read crm_contacts"          on crm_contacts;
drop policy if exists "Staff write crm_contacts"         on crm_contacts;
drop policy if exists "Staff update crm_contacts"        on crm_contacts;
drop policy if exists "Staff delete crm_contacts"        on crm_contacts;

create policy "Staff read crm_contacts"
  on crm_contacts for select
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff','readonly')
    )
  );

create policy "Staff write crm_contacts"
  on crm_contacts for insert
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff update crm_contacts"
  on crm_contacts for update
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  )
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff delete crm_contacts"
  on crm_contacts for delete
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );


-- ── crm_partners ────────────────────────────────────────────────────────────

drop policy if exists "Founder full access crm_partners" on crm_partners;
drop policy if exists "Staff read crm_partners"          on crm_partners;
drop policy if exists "Staff write crm_partners"         on crm_partners;
drop policy if exists "Staff update crm_partners"        on crm_partners;
drop policy if exists "Staff delete crm_partners"        on crm_partners;

create policy "Staff read crm_partners"
  on crm_partners for select
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff','readonly')
    )
  );

create policy "Staff write crm_partners"
  on crm_partners for insert
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff update crm_partners"
  on crm_partners for update
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  )
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff delete crm_partners"
  on crm_partners for delete
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );


-- ── vendors ─────────────────────────────────────────────────────────────────

drop policy if exists "Founder full access vendors" on vendors;
drop policy if exists "Staff read vendors"          on vendors;
drop policy if exists "Staff write vendors"         on vendors;
drop policy if exists "Staff update vendors"        on vendors;
drop policy if exists "Staff delete vendors"        on vendors;

create policy "Staff read vendors"
  on vendors for select
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff','readonly')
    )
  );

create policy "Staff write vendors"
  on vendors for insert
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff update vendors"
  on vendors for update
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  )
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff delete vendors"
  on vendors for delete
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );
