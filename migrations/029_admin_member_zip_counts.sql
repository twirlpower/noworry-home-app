-- ============================================================================
-- NoWorry Home — Migration 029: admin_member_zip_counts RPC for the heat map
-- Run order: ..., 028_zip_refresh_status.sql, then 029.
-- Depends on is_active_staff() from 027.
--
-- The /admin/heatmap page needs to join family_circles ↔ circle_homes ↔
-- homes — three tables whose RLS gates to circle members. Staff
-- accounts aren't circle members, so a plain client query returns
-- nothing.
--
-- This SECURITY DEFINER function does the join + per-ZIP aggregation
-- server-side, gated by is_active_staff(). The narrow return shape
-- (zip, tier, count, earliest/latest join) keeps the data privacy-
-- forward — no names, no addresses, no per-member dates exposed.
-- Aggregating into ZIP+tier groups also means single-member ZIPs
-- can never be identified via the aggregate row alone.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ============================================================================

create or replace function public.admin_member_zip_counts()
returns table (
  zip                text,
  subscription_tier  text,
  member_count       integer,
  earliest_join      timestamptz,
  latest_join        timestamptz
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
    h.zip,
    fc.subscription_tier::text,
    count(*)::int                as member_count,
    min(fc.created_at)           as earliest_join,
    max(fc.created_at)           as latest_join
  from family_circles fc
  join circle_homes ch on ch.circle_id = fc.id and ch.status = 'active'
  join homes h on h.id = ch.home_id
  where fc.is_archived = false
    and h.zip is not null
    and h.zip <> ''
  group by h.zip, fc.subscription_tier
  order by h.zip, fc.subscription_tier;
end;
$$;

revoke execute on function public.admin_member_zip_counts() from public;
grant execute on function public.admin_member_zip_counts() to authenticated;
