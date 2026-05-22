-- ============================================================================
-- NoWorry Home — Migration 034: hometech_accounts + tech_list_homes RPC
-- Run order: ..., 033_admin_list_members.sql, then 034.
-- Depends on update_updated_at() (021), is_active_staff() (027).
--
-- HomeTechs are the field technicians who do home visits. A separate
-- account table from staff_accounts so a single person CAN be both
-- (owner who also dispatches themselves) without conflating role checks
-- across the two systems.
--
-- RLS uses is_active_hometech() (added here) and is_active_staff() (from
-- 027). Both are SECURITY DEFINER, so policy sub-selects don't recurse
-- — same pattern that fixed the staff_accounts recursion in 027.
--
-- Also adds tech_list_homes(p_market) RPC backing the field app's home
-- list. SECURITY DEFINER + is_active_hometech / is_active_staff guard
-- so the route returns member PII only to authorized callers.
--
-- Idempotent throughout.
-- ============================================================================

create table if not exists hometech_accounts (
  id                          uuid primary key default gen_random_uuid(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  user_id                     uuid references auth.users(id) on delete cascade not null unique,
  email                       text not null unique,
  name                        text not null,
  phone                       text,

  active                      boolean not null default true,

  background_check_status     text not null default 'pending',
  background_check_date       date,
  activation_fee_paid         boolean not null default false,
  activation_fee_paid_date    date,

  primary_market              text default 'aurora',
  notes                       text
);

create index if not exists idx_hometech_accounts_active
  on hometech_accounts(active) where active = true;

alter table hometech_accounts enable row level security;


-- ── is_active_hometech() — recursion-safe helper, mirrors is_active_staff ───
create or replace function public.is_active_hometech()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from hometech_accounts
    where user_id = auth.uid()
      and active = true
  );
$$;

revoke execute on function public.is_active_hometech() from public;
grant  execute on function public.is_active_hometech() to authenticated;


-- ── RLS policies ────────────────────────────────────────────────────────────
-- The "read own row" policy uses auth.uid() directly (no recursion). The
-- staff policies use the SECURITY DEFINER helpers from 027.

drop policy if exists "HomeTech read own row"           on hometech_accounts;
drop policy if exists "Staff read hometech_accounts"    on hometech_accounts;
drop policy if exists "Staff write hometech_accounts"   on hometech_accounts;
drop policy if exists "Staff update hometech_accounts"  on hometech_accounts;

create policy "HomeTech read own row"
  on hometech_accounts for select
  using (user_id = auth.uid());

create policy "Staff read hometech_accounts"
  on hometech_accounts for select
  using (public.is_active_staff(array['owner','staff','readonly']));

create policy "Staff write hometech_accounts"
  on hometech_accounts for insert
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff update hometech_accounts"
  on hometech_accounts for update
  using (public.is_active_staff(array['owner','staff']))
  with check (public.is_active_staff(array['owner','staff']));


-- ── updated_at trigger ─────────────────────────────────────────────────────
drop trigger if exists hometech_accounts_updated_at on hometech_accounts;
create trigger hometech_accounts_updated_at
  before update on hometech_accounts
  for each row execute function public.update_updated_at();


-- ── Owner seed ─────────────────────────────────────────────────────────────
-- No-op if the auth user doesn't exist yet; ON CONFLICT covers re-runs.
insert into hometech_accounts
  (user_id, email, name, phone, active, background_check_status,
   activation_fee_paid, primary_market)
select id,
       'tye@noworry-home.com',
       'Tye Olmsted',
       '3033191159',
       true, 'passed', true, 'aurora'
from auth.users
where email = 'tye@noworry-home.com'
on conflict (email) do nothing;


-- ── tech_list_homes(p_market) — home list for the field app ────────────────
-- Returns Covered + Complete homes with a primary contact + last visit
-- placeholder. p_market is accepted for future per-market routing; the
-- v1 query returns all qualifying homes (markets are derived from ZIP
-- centroids client-side, not stored on homes).
--
-- Auth: active home tech OR active staff (owner/staff/readonly). Owner
-- dual-role users pass both checks.

create or replace function public.tech_list_homes(p_market text default 'aurora')
returns table (
  circle_id            uuid,
  address_line1        text,
  city                 text,
  zip                  text,
  subscription_tier    text,
  member_name          text,
  member_phone         text,
  last_visit_date      date,
  assessment_complete  boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_active_hometech()
       or public.is_active_staff(array['owner','staff','readonly'])) then
    raise exception 'Not authorized — home tech or staff only';
  end if;

  -- p_market reserved for future filtering — silenced.
  perform p_market;

  return query
  select
    fc.id,
    h.address_line1,
    h.city,
    h.zip,
    fc.subscription_tier::text,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as member_name,
    p.phone,
    null::date,
    false
  from family_circles fc
  join circle_homes ch
    on ch.circle_id = fc.id
   and ch.status = 'active'
   and ch.is_primary = true
  join homes h on h.id = ch.home_id
  left join circle_memberships cm
    on cm.circle_id = fc.id
   and cm.role in ('home_owner', 'circle_manager')
   and cm.status = 'active'
  left join persons p on p.id = cm.person_id
  where fc.subscription_tier in ('covered', 'complete')
    and fc.is_archived = false
  order by h.address_line1;
end;
$$;

revoke execute on function public.tech_list_homes(text) from public;
grant  execute on function public.tech_list_homes(text) to authenticated;
