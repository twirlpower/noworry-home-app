-- ============================================================================
-- NoWorry Home — Migration 033: admin_list_members RPC
-- Run order: ..., 032_promo_redemptions.sql, then 033.
-- Depends on is_active_staff() from 027.
--
-- Backs /admin/members. Returns one row per (circle, qualifying member) —
-- a circle with two active home_owner/circle_manager rows appears twice,
-- which matches admin_list_customers (migration 030) and the spec's
-- "Manage" button acting on a person, not a circle.
--
-- The three filter parameters are optional. The client today passes nulls
-- for all three and filters client-side because the page's tier filter is
-- multi-select; the RPC keeps the single-value params so direct SQL
-- callers (admin SQL queries, future server-side paths) can still
-- pre-filter.
--
-- Return shape extends the original spec with address_line1 / address_line2
-- because the page's row-expand detail panel needs them to render
-- "Full address if available".
--
-- SECURITY DEFINER + is_active_staff() guard. The function joins through
-- auth.users, which the function owner (postgres) can read; raw client
-- queries against auth.users would fail.
-- ============================================================================

create or replace function public.admin_list_members(
  p_tier            text default null,
  p_zip             text default null,
  p_billing_status  text default null
)
returns table (
  circle_id          uuid,
  circle_name        text,
  subscription_tier  text,
  billing_status     text,
  trial_ends_at      timestamptz,
  created_at         timestamptz,
  zip                text,
  city               text,
  address_line1      text,
  address_line2      text,
  member_name        text,
  member_email       text,
  home_id            uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff(array['owner','staff','readonly']) then
    raise exception 'Not authorized — staff only';
  end if;

  return query
  select
    fc.id,
    fc.name,
    fc.subscription_tier::text,
    fc.billing_status,
    fc.trial_ends_at,
    fc.created_at,
    h.zip,
    h.city,
    h.address_line1,
    h.address_line2,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as member_name,
    -- persons.email is mirrored at signup; auth.users.email is authoritative.
    coalesce(p.email, u.email) as member_email,
    h.id
  from family_circles fc
  -- Active + primary home keeps the row count to one per circle on the
  -- home side. circle_homes can have multiple rows per circle for
  -- secondary homes; this picks the primary one.
  left join circle_homes ch
    on ch.circle_id = fc.id
   and ch.status = 'active'
   and ch.is_primary = true
  left join homes h
    on h.id = ch.home_id
  left join circle_memberships cm
    on cm.circle_id = fc.id
   and cm.role in ('home_owner', 'circle_manager')
   and cm.status = 'active'
  left join persons p
    on p.id = cm.person_id
  left join auth.users u
    on u.id = p.auth_id
  where
    fc.is_archived = false
    and (p_tier is null or fc.subscription_tier::text = p_tier)
    and (p_zip is null or h.zip = p_zip)
    and (p_billing_status is null or fc.billing_status = p_billing_status)
  order by fc.created_at desc, member_name;
end;
$$;

revoke execute on function public.admin_list_members(text, text, text) from public;
grant  execute on function public.admin_list_members(text, text, text) to authenticated;
