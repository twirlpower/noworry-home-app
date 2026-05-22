-- ============================================================================
-- NoWorry Home — Migration 018: staff_accounts (role system)
-- Run order: ..., 017_admin_crm_tables.sql, then 018.
--
-- Scope: replace the hardcoded FOUNDER_EMAIL gate in App.jsx with a proper
-- role system. Staff accounts are independent of family_circles — they don't
-- need a Home to log in and they never see the member-facing app.
--
-- Roles:
--   owner    — full access, all admin pages (current founder)
--   staff    — CRM + dispatch read/write, no settings
--   readonly — view-only CRM, no edits
--
-- Note on CRM RLS: the policies on crm_contacts / crm_partners / vendors
-- (migration 017) still hardcode tye@oakraa.com. Staff with other emails
-- will see empty tables in the CRM until those policies are extended to
-- accept the new role table. Tracked as follow-up.
-- ============================================================================

create table if not exists staff_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  email       text not null unique,
  name        text not null,
  role        text not null default 'staff',
  active      boolean default true,
  created_at  timestamptz default now(),
  notes       text
);

alter table staff_accounts enable row level security;

-- ── policies ───────────────────────────────────────────────────────────────
-- "Staff can read own row" is the base case the owner-check below relies on:
-- when the owner-check subquery re-enters this table, the own-row clause
-- terminates the recursion (auth.uid() matches without needing the owner
-- branch to evaluate). This is the standard Supabase pattern for
-- self-referential role tables.
drop policy if exists "Staff can read own row" on staff_accounts;
create policy "Staff can read own row"
  on staff_accounts for select
  using (user_id = auth.uid());

drop policy if exists "Owner full access staff_accounts" on staff_accounts;
create policy "Owner full access staff_accounts"
  on staff_accounts for all
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.role = 'owner'
        and sa.active = true
    )
  )
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.role = 'owner'
        and sa.active = true
    )
  );

-- ── seeds ──────────────────────────────────────────────────────────────────
-- Owner: tye@oakraa.com. No-op if the auth user doesn't exist yet — the
-- INSERT...SELECT pulls zero rows. ON CONFLICT covers re-runs.
insert into staff_accounts (user_id, email, name, role, notes)
select id, 'tye@oakraa.com', 'Tye Olmsted', 'owner', 'Founder account'
from auth.users
where email = 'tye@oakraa.com'
on conflict (email) do nothing;

-- Staff: tye.olmsted@oakraa.com. Must be invited via Supabase Auth UI first
-- (Authentication → Users → Invite user). This insert no-ops until then.
insert into staff_accounts (user_id, email, name, role, notes)
select id, 'tye.olmsted@oakraa.com', 'Tye Olmsted (Staff)', 'staff',
       'Backend admin — no home required'
from auth.users
where email = 'tye.olmsted@oakraa.com'
on conflict (email) do nothing;

-- ── RPC: add_staff_account ─────────────────────────────────────────────────
-- The client cannot query auth.users (locked down), so the AdminSettings
-- "Add Staff" form can't look up user_id by email on its own. This RPC does
-- the lookup server-side under SECURITY DEFINER and enforces:
--   - caller must be an active owner
--   - new role must be 'staff' or 'readonly' (never 'owner' via this path)
--   - target email must already exist in auth.users
create or replace function add_staff_account(
  p_email text,
  p_name text,
  p_role text,
  p_notes text default null
)
returns staff_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_row staff_accounts;
begin
  if not exists (
    select 1 from staff_accounts
    where user_id = auth.uid()
      and role = 'owner'
      and active = true
  ) then
    raise exception 'Only owners can add staff accounts';
  end if;

  if p_role not in ('staff', 'readonly') then
    raise exception 'Invalid role: %', p_role;
  end if;

  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'No auth user with email %. Invite them via Supabase Auth first.', p_email;
  end if;

  insert into staff_accounts (user_id, email, name, role, notes)
  values (v_user_id, p_email, p_name, p_role, p_notes)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function add_staff_account(text, text, text, text) from public;
grant execute on function add_staff_account(text, text, text, text) to authenticated;
