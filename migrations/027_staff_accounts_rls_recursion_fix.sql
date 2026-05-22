-- ============================================================================
-- NoWorry Home — Migration 027: fix infinite recursion in staff_accounts RLS
-- Run order: ..., 026_maintenance_seasonal_anchors.sql, then 027.
--
-- THE BUG
--   Postgres error 42P17: "infinite recursion detected in policy for
--   relation \"staff_accounts\""
--
--   Migration 018's "Owner full access staff_accounts" policy uses:
--     exists (select 1 from staff_accounts sa where sa.user_id = auth.uid()
--             and sa.role = 'owner' and sa.active = true)
--
--   When the client queries staff_accounts:
--     1. RLS evaluates the "Owner full access" policy.
--     2. That policy's sub-SELECT hits staff_accounts → RLS triggers again.
--     3. The same policy applies → another sub-SELECT → Postgres detects
--        the cycle and rejects the whole query before evaluating it.
--
--   Effect: every query against staff_accounts fails. Because the admin
--   tables (vendor_jobs from 024, crm_contacts/partners/vendors from 025,
--   maintenance_templates from 026) ALL check staff_accounts via the same
--   EXISTS subquery, every admin query is broken the same way.
--
-- THE FIX
--   Wrap the staff-role check in a SECURITY DEFINER function. Inside that
--   function the SELECT against staff_accounts runs as the function owner
--   (postgres) and bypasses RLS entirely — so no inner recursion fires.
--   This is the canonical Supabase pattern for self-referential role tables.
--
--   New functions:
--     is_active_staff(allowed_roles text[]) — parameterized role check
--     is_staff_owner()                       — convenience for owner-only
--
--   Then every affected policy is dropped and recreated to call the
--   function instead of doing the inline EXISTS.
--
-- Idempotent: CREATE OR REPLACE for functions, DROP IF EXISTS + CREATE
-- for every policy. Safe to re-run.
-- ============================================================================


-- ── 1. SECURITY DEFINER helpers ─────────────────────────────────────────────
-- STABLE so Postgres can cache the result within a single statement. The
-- search_path lock prevents schema-shadow attacks (same hygiene as
-- migration 021's update_updated_at fix).

create or replace function public.is_active_staff(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff_accounts
    where user_id = auth.uid()
      and active = true
      and role = any(allowed_roles)
  );
$$;

create or replace function public.is_staff_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff(array['owner']);
$$;

-- Callable by every signed-in user (it just returns true/false). Anon
-- access is unnecessary — RLS only runs for authenticated requests.
revoke execute on function public.is_active_staff(text[]) from public;
revoke execute on function public.is_staff_owner() from public;
grant execute on function public.is_active_staff(text[]) to authenticated;
grant execute on function public.is_staff_owner() to authenticated;


-- ── 2. staff_accounts itself ────────────────────────────────────────────────
-- "Staff can read own row" stays as-is — auth.uid() comparison, no recursion.
-- "Owner full access" switches to is_staff_owner() and stops recursing.

drop policy if exists "Owner full access staff_accounts" on staff_accounts;
create policy "Owner full access staff_accounts"
  on staff_accounts for all
  using (public.is_staff_owner())
  with check (public.is_staff_owner());


-- ── 3. vendor_jobs (was migration 024) ──────────────────────────────────────

drop policy if exists "Staff read vendor_jobs"   on vendor_jobs;
drop policy if exists "Staff write vendor_jobs"  on vendor_jobs;
drop policy if exists "Staff update vendor_jobs" on vendor_jobs;
drop policy if exists "Staff delete vendor_jobs" on vendor_jobs;

create policy "Staff read vendor_jobs"
  on vendor_jobs for select
  using (public.is_active_staff(array['owner','staff','readonly']));

create policy "Staff write vendor_jobs"
  on vendor_jobs for insert
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff update vendor_jobs"
  on vendor_jobs for update
  using (public.is_active_staff(array['owner','staff']))
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff delete vendor_jobs"
  on vendor_jobs for delete
  using (public.is_active_staff(array['owner','staff']));


-- ── 4. crm_contacts (was migration 025) ─────────────────────────────────────

drop policy if exists "Staff read crm_contacts"   on crm_contacts;
drop policy if exists "Staff write crm_contacts"  on crm_contacts;
drop policy if exists "Staff update crm_contacts" on crm_contacts;
drop policy if exists "Staff delete crm_contacts" on crm_contacts;

create policy "Staff read crm_contacts"
  on crm_contacts for select
  using (public.is_active_staff(array['owner','staff','readonly']));

create policy "Staff write crm_contacts"
  on crm_contacts for insert
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff update crm_contacts"
  on crm_contacts for update
  using (public.is_active_staff(array['owner','staff']))
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff delete crm_contacts"
  on crm_contacts for delete
  using (public.is_active_staff(array['owner','staff']));


-- ── 5. crm_partners (was migration 025) ─────────────────────────────────────

drop policy if exists "Staff read crm_partners"   on crm_partners;
drop policy if exists "Staff write crm_partners"  on crm_partners;
drop policy if exists "Staff update crm_partners" on crm_partners;
drop policy if exists "Staff delete crm_partners" on crm_partners;

create policy "Staff read crm_partners"
  on crm_partners for select
  using (public.is_active_staff(array['owner','staff','readonly']));

create policy "Staff write crm_partners"
  on crm_partners for insert
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff update crm_partners"
  on crm_partners for update
  using (public.is_active_staff(array['owner','staff']))
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff delete crm_partners"
  on crm_partners for delete
  using (public.is_active_staff(array['owner','staff']));


-- ── 6. vendors (was migration 025) ──────────────────────────────────────────

drop policy if exists "Staff read vendors"   on vendors;
drop policy if exists "Staff write vendors"  on vendors;
drop policy if exists "Staff update vendors" on vendors;
drop policy if exists "Staff delete vendors" on vendors;

create policy "Staff read vendors"
  on vendors for select
  using (public.is_active_staff(array['owner','staff','readonly']));

create policy "Staff write vendors"
  on vendors for insert
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff update vendors"
  on vendors for update
  using (public.is_active_staff(array['owner','staff']))
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff delete vendors"
  on vendors for delete
  using (public.is_active_staff(array['owner','staff']));


-- ── 7. maintenance_templates (was migration 026) ────────────────────────────
-- The SELECT policy from migration 004 (maint_templates_select) uses
-- auth.uid() directly and is fine — leaving it alone. Only the write
-- policies need rewriting.

drop policy if exists "Staff write maintenance_templates"  on maintenance_templates;
drop policy if exists "Staff update maintenance_templates" on maintenance_templates;
drop policy if exists "Staff delete maintenance_templates" on maintenance_templates;

create policy "Staff write maintenance_templates"
  on maintenance_templates for insert
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff update maintenance_templates"
  on maintenance_templates for update
  using (public.is_active_staff(array['owner','staff']))
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff delete maintenance_templates"
  on maintenance_templates for delete
  using (public.is_active_staff(array['owner','staff']));


-- ── 8. Notes on the SECURITY DEFINER functions in migrations 026 ────────────
-- generate_maintenance_for_home() and admin_regenerate_all_maintenance()
-- both contain inline staff_accounts EXISTS checks. Those run inside a
-- SECURITY DEFINER function context, which already bypasses RLS for the
-- function's own queries, so they do NOT recurse and need no change here.
