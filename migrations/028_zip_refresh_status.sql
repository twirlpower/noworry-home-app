-- ============================================================================
-- NoWorry Home — Migration 028: ZIP-level property refresh tracking
-- Run order: ..., 027_staff_accounts_rls_recursion_fix.sql, then 028.
-- Depends on the is_active_staff() helper added in 027.
--
-- Backing the new /admin/properties page. The home_seeds table holds
-- ~301K county-assessor address rows; refresh status is a per-ZIP
-- concept, not per-address. Storing last_refreshed_at on home_seeds
-- itself would duplicate the same ZIP-level value across hundreds of
-- thousands of rows for no UX benefit. This migration creates a small
-- ZIP-keyed table instead.
--
-- Backfill: one row per distinct zip currently present in home_seeds,
-- with property_count = COUNT(*) per zip and last_refreshed_at = NULL
-- ("never refreshed since the original seed import"). Subsequent
-- refresh batches will update last_refreshed_at + property_count.
--
-- RLS uses is_active_staff() so the policies don't recurse — same
-- pattern 027 normalized across the admin tables.
--
-- Idempotent.
-- ============================================================================

create table if not exists zip_refresh_status (
  zip                text primary key,
  city               text,
  state              text,
  property_count     integer not null default 0,
  last_refreshed_at  timestamptz,
  refresh_flagged    boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_zip_refresh_status_state
  on zip_refresh_status(state);
create index if not exists idx_zip_refresh_status_refresh_flagged
  on zip_refresh_status(refresh_flagged) where refresh_flagged = true;

-- updated_at trigger (reuses the helper from migration 021).
drop trigger if exists set_updated_at on zip_refresh_status;
create trigger set_updated_at before update on zip_refresh_status
  for each row execute function public.update_updated_at();

-- Backfill from home_seeds. The DISTINCT + COUNT in one pass is the cheap
-- way to get this right on first apply. ON CONFLICT DO NOTHING means
-- subsequent runs of this migration won't clobber refresh status that
-- batches have set, but DO update property_count / city / state on
-- conflict so the row stays accurate if the seed table grows.
insert into zip_refresh_status (zip, city, state, property_count)
select
  hs.zip,
  -- Pick the most common (zip, city) pair. assessor data can have minor
  -- spelling variants in city even within one ZIP; mode() picks the
  -- dominant value.
  mode() within group (order by hs.city)  as city,
  mode() within group (order by hs.state) as state,
  count(*)::int                            as property_count
from home_seeds hs
where hs.zip is not null and hs.zip <> ''
group by hs.zip
on conflict (zip) do update
  set city           = coalesce(zip_refresh_status.city, excluded.city),
      state          = coalesce(zip_refresh_status.state, excluded.state),
      property_count = excluded.property_count,
      updated_at     = now();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table zip_refresh_status enable row level security;

drop policy if exists "Staff read zip_refresh_status"   on zip_refresh_status;
drop policy if exists "Staff write zip_refresh_status"  on zip_refresh_status;
drop policy if exists "Staff update zip_refresh_status" on zip_refresh_status;
drop policy if exists "Staff delete zip_refresh_status" on zip_refresh_status;

create policy "Staff read zip_refresh_status"
  on zip_refresh_status for select
  using (public.is_active_staff(array['owner','staff','readonly']));

create policy "Staff write zip_refresh_status"
  on zip_refresh_status for insert
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff update zip_refresh_status"
  on zip_refresh_status for update
  using (public.is_active_staff(array['owner','staff']))
  with check (public.is_active_staff(array['owner','staff']));

create policy "Staff delete zip_refresh_status"
  on zip_refresh_status for delete
  using (public.is_active_staff(array['owner','staff']));
