-- ============================================================================
-- NoWorry Home — Migration 037: billing_cycle + trial_days on family_circles
-- Run order: ..., 036_home_visits.sql, then 037.
--
-- Two new columns:
--   billing_cycle — 'monthly' | 'annual' (default 'monthly')
--   trial_days    — 30 standard, 90 for partner-promo trials
--
-- The defaults preserve existing behavior — rows without these set behave
-- as monthly + 30-day trials. create-subscription.mjs stamps both on
-- successful subscription creation; Dashboard + Settings read them to
-- render the right billing copy.
--
-- Idempotent (IF NOT EXISTS).
-- ============================================================================

alter table family_circles
  add column if not exists billing_cycle text default 'monthly',
  add column if not exists trial_days    integer default 30;

comment on column family_circles.billing_cycle is
  'monthly | annual — selected at PaymentModal checkout.';
comment on column family_circles.trial_days is
  '30 default, 90 when partner promotion code is applied (metadata.partner_trial = true on the promotion code in Stripe).';
