-- ============================================================================
-- NoWorry Home — Migration 023: seed tye@noworry-home.com as an owner
-- Run order: ..., 022_billing_columns.sql, then 023.
--
-- Migration 018 seeded the owner row using the @oakraa.com address — which
-- was the founder's email at the time. The owner now signs in as
-- tye@noworry-home.com and was landing on /dashboard instead of /admin/crm
-- because useStaffRole correctly reported isStaff=false (no matching row).
--
-- This insert is idempotent via ON CONFLICT (email) and a no-op if the
-- @noworry-home.com auth user doesn't exist yet — the SELECT pulls zero
-- rows in that case. Once the user is invited via Supabase Auth, re-run.
-- ============================================================================

insert into staff_accounts (user_id, email, name, role, notes)
select id, 'tye@noworry-home.com', 'Tye Olmsted', 'owner',
       'Owner account — noworry-home.com'
from auth.users
where email = 'tye@noworry-home.com'
on conflict (email) do nothing;
