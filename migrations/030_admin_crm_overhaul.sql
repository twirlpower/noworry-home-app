-- ============================================================================
-- NoWorry Home — Migration 030: Admin CRM overhaul + account management
--                              + address uniqueness enforcement
-- Run order: ..., 029_admin_member_zip_counts.sql, then 030.
-- Depends on is_active_staff() from 027.
--
-- Bundles the DB side of the Admin CRM overhaul (parts B, G, H):
--
--   1. Status field on crm_contacts (Leads pipeline tracking)
--   2. Status + contact fields on crm_partners
--   3. normalize_address(text) SQL function (parity with the JS lib so
--      uniqueness checks match what the client sees)
--   4. normalized_address column on homes + index + trigger + backfill
--   5. Server-side RPCs for the Customers admin tab:
--        admin_list_customers()      — joined view across persons,
--                                      circle_memberships, family_circles
--        admin_update_person()       — edit first/last/phone safely
--        admin_set_circle_tier()     — manual tier override
--        check_home_address_taken()  — onboarding uniqueness probe
--
-- crm_contacts.circle_id already exists from migration 017, so the
-- "lead conversion" flow can reuse it directly — no schema change.
-- vendors.status already exists; 'do_not_use' is a new UI value with
-- no enum constraint to update.
--
-- Idempotent throughout. SECURITY DEFINER functions guarded by
-- is_active_staff to avoid the recursion footgun.
-- ============================================================================


-- ── 1. crm_contacts status ──────────────────────────────────────────────────
alter table crm_contacts
  add column if not exists status text not null default 'lead';

comment on column crm_contacts.status is
  'lead | contacted | qualified | converted | inactive — pipeline stage.';


-- ── 2. crm_partners status + contact fields ─────────────────────────────────
alter table crm_partners
  add column if not exists status            text not null default 'prospect',
  add column if not exists phone             text,
  add column if not exists email             text,
  add column if not exists preferred_contact text default 'email',
  add column if not exists address           text;

comment on column crm_partners.status is
  'prospect | active | inactive | do_not_use — referral relationship status.';
comment on column crm_partners.preferred_contact is
  'email | phone | either — primary contact mode.';


-- ── 3. normalize_address(text) — JS-parity SQL ──────────────────────────────
-- Mirrors src/lib/normalizeAddress.js. Chained regexp_replace expansion
-- maps each long-form street type to its USPS-style abbreviation (a
-- single-pass approach can't conditionally pick the replacement per
-- matched word in Postgres). IMMUTABLE, search_path-locked.
create or replace function public.normalize_address(p_input text)
returns text
language sql
immutable
set search_path = public
as $$
  with cleaned as (
    select translate(upper(coalesce(trim(p_input), '')), '.,#', '   ') as v
  ),
  expanded as (
    select regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(v,
                          '\mSTREET\M',    'ST',   'g'),
                        '\mAVENUE\M',     'AVE',  'g'),
                      '\mBOULEVARD\M',    'BLVD', 'g'),
                    '\mDRIVE\M',          'DR',   'g'),
                  '\mCOURT\M',            'CT',   'g'),
                '\mLANE\M',               'LN',   'g'),
              '\mROAD\M',                 'RD',   'g'),
            '\mPLACE\M',                  'PL',   'g'),
          '\mCIRCLE\M',                   'CIR',  'g'),
        '\mTERRACE\M',                    'TER',  'g'),
      '\mWAY\M',                          'WY',   'g')
      as v
    from cleaned
  )
  select trim(regexp_replace(v, '\s+', ' ', 'g')) from expanded
$$;


-- ── 4. homes.normalized_address + trigger + backfill + index ────────────────
alter table homes
  add column if not exists normalized_address text;

create or replace function public.homes_set_normalized_address()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.normalized_address := public.normalize_address(new.address_line1);
  return new;
end;
$$;

drop trigger if exists homes_normalize_address on homes;
create trigger homes_normalize_address
  before insert or update of address_line1
  on homes
  for each row execute function public.homes_set_normalized_address();

-- One-shot backfill applying the same function. Re-running is idempotent —
-- the function is deterministic, so subsequent runs are no-ops.
update homes
   set normalized_address = public.normalize_address(address_line1)
 where normalized_address is null
    or normalized_address <> public.normalize_address(address_line1);

create index if not exists idx_homes_normalized_address
  on homes(normalized_address, zip);


-- ── 5. check_home_address_taken — onboarding uniqueness probe ───────────────
-- Returns the home_id and circle_id of an active claim at the given
-- normalized address + zip, or NULLs if free. SECURITY DEFINER so it
-- bypasses the member-only RLS on homes / circle_homes — the onboarding
-- user can't yet see those tables via their own session.
create or replace function public.check_home_address_taken(
  p_normalized_address text,
  p_zip                text
)
returns table (home_id uuid, circle_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select h.id, ch.circle_id
  from homes h
  join circle_homes ch on ch.home_id = h.id and ch.status = 'active'
  where h.normalized_address = p_normalized_address
    and h.zip = p_zip
  limit 1
$$;

revoke execute on function public.check_home_address_taken(text, text) from public;
grant  execute on function public.check_home_address_taken(text, text) to authenticated;


-- ── 6. admin_list_customers — Customers tab data source ─────────────────────
-- Returns one row per active home_owner / circle_manager membership.
-- Includes the persons.auth_id so the client can call the admin API
-- routes (reset/disable/delete) with the right user id.
create or replace function public.admin_list_customers()
returns table (
  circle_id           uuid,
  person_id           uuid,
  auth_user_id        uuid,
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  role                text,
  subscription_tier   text,
  billing_status      text,
  trial_started_at    timestamptz,
  trial_ends_at       timestamptz,
  current_period_end  timestamptz,
  member_since        timestamptz
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
    p.id,
    p.auth_id,
    p.first_name,
    p.last_name,
    p.email,
    p.phone,
    cm.role::text,
    fc.subscription_tier::text,
    fc.billing_status,
    fc.trial_started_at,
    fc.trial_ends_at,
    fc.current_period_end,
    fc.created_at
  from family_circles fc
  join circle_memberships cm on cm.circle_id = fc.id and cm.status = 'active'
  join persons p on p.id = cm.person_id
  where cm.role in ('home_owner', 'circle_manager')
    and fc.is_archived = false
  order by fc.created_at desc;
end;
$$;

revoke execute on function public.admin_list_customers() from public;
grant  execute on function public.admin_list_customers() to authenticated;


-- ── 7. admin_update_person — Customers tab inline edit ──────────────────────
create or replace function public.admin_update_person(
  p_person_id   uuid,
  p_first_name  text,
  p_last_name   text,
  p_phone       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff(array['owner','staff']) then
    raise exception 'Not authorized — owner or staff only';
  end if;

  update persons
     set first_name = p_first_name,
         last_name  = p_last_name,
         phone      = p_phone
   where id = p_person_id;
end;
$$;

revoke execute on function public.admin_update_person(uuid, text, text, text) from public;
grant  execute on function public.admin_update_person(uuid, text, text, text) to authenticated;


-- ── 8. admin_set_circle_tier — Customers tab manual tier override ───────────
create or replace function public.admin_set_circle_tier(
  p_circle_id uuid,
  p_tier      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff(array['owner','staff']) then
    raise exception 'Not authorized — owner or staff only';
  end if;

  if p_tier not in ('aware', 'prepared', 'covered', 'complete') then
    raise exception 'Invalid tier: %', p_tier;
  end if;

  update family_circles
     set subscription_tier = p_tier::subscription_tier
   where id = p_circle_id;
end;
$$;

revoke execute on function public.admin_set_circle_tier(uuid, text) from public;
grant  execute on function public.admin_set_circle_tier(uuid, text) to authenticated;
