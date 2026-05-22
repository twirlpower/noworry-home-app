-- ============================================================================
-- NoWorry Home — Migration 032: promo_redemptions audit log
-- Run order: ..., 031_notes_insert_family_member.sql, then 032.
-- Depends on is_active_staff() from 027.
--
-- One row per successful Stripe subscription creation where a promotion
-- code was applied. Server-side audit log so the admin Finance page can
-- show "who used which code" alongside Stripe's aggregate
-- times_redeemed counter. circle_id is captured (FK with SET NULL on
-- delete) so a redemption can survive an eventual customer wipe.
--
-- Inserts come from api/stripe/create-subscription.mjs using the
-- service-role key, which bypasses RLS. The RLS policies here gate
-- READ access for the admin UI and INSERT for any future client-side
-- callers; service-role writes are unaffected.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS +
-- CREATE POLICY.
-- ============================================================================

create table if not exists promo_redemptions (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  circle_id              uuid references family_circles(id) on delete set null,
  coupon_code            text not null,
  coupon_name            text,
  discount_description   text,
  stripe_subscription_id text,
  stripe_customer_id     text
);

create index if not exists idx_promo_redemptions_circle on promo_redemptions(circle_id);
create index if not exists idx_promo_redemptions_code on promo_redemptions(coupon_code);

alter table promo_redemptions enable row level security;

drop policy if exists "Staff read promo_redemptions"  on promo_redemptions;
drop policy if exists "Staff write promo_redemptions" on promo_redemptions;

create policy "Staff read promo_redemptions"
  on promo_redemptions for select
  using (public.is_active_staff(array['owner','staff','readonly']));

create policy "Staff write promo_redemptions"
  on promo_redemptions for insert
  with check (public.is_active_staff(array['owner','staff']));
