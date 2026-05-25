-- ============================================================================
-- NoWorry Home — Migration 044: founder ownership → tye@noworry-home.com
-- Run order: ..., 043_homeowner_view_preference.sql, then 044.
-- Depends on: staff_accounts (migration 018).
--
-- Migration 018 seeded tye@oakraa.com as the initial owner — that was
-- a placeholder during early development. The canonical founder admin
-- account going forward is tye@noworry-home.com. This migration:
--
--   1. Inserts (or upgrades) tye@noworry-home.com as an active owner.
--      Same INSERT...SELECT FROM auth.users pattern as migration 018
--      so the auth-user resolution happens server-side (client can't
--      query auth.users). ON CONFLICT (email) DO UPDATE normalizes
--      role + active for re-runs.
--
--   2. Deletes the legacy tye@oakraa.com staff_accounts row.
--      Belt-and-suspenders gate: only fires if the new owner row is
--      actually present and active. If the noworry-home.com auth user
--      didn't exist at migration time (the INSERT no-opped), the
--      DELETE also no-ops so we don't orphan ownership of the
--      system. Once the auth user is invited and the migration is
--      re-run, both pieces complete.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

insert into staff_accounts (user_id, email, name, role, active, notes)
select id, 'tye@noworry-home.com', 'Tye Olmsted', 'owner', true,
       'Canonical founder admin (migration 044, ownership transfer from tye@oakraa.com).'
from auth.users
where email = 'tye@noworry-home.com'
on conflict (email) do update
  set role   = 'owner',
      active = true,
      name   = excluded.name,
      notes  = excluded.notes;

delete from staff_accounts
where email = 'tye@oakraa.com'
  and exists (
    select 1 from staff_accounts sa
    where sa.email = 'tye@noworry-home.com'
      and sa.role = 'owner'
      and sa.active = true
  );
