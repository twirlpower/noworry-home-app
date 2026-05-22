-- ============================================================================
-- NoWorry Home — Migration 022: Stripe billing columns on family_circles
-- Run order: ..., 021_security_linter_fixes.sql, then 022.
--
-- Scope: stand up the columns the Stripe integration writes to. No RLS
-- changes — circles_update (rls_policies_v1.sql) already gates updates to
-- the Family-write role array, which is the right set for billing changes.
--
-- billing_status model:
--   NULL        — never had a billing event (e.g. brand-new Aware circle)
--   'trial'     — Prepared trial running (set in handleStartTrial)
--   'active'    — paid subscription, current period covers today
--   'past_due'  — Stripe reported a failed renewal (set by Phase 3 webhook)
--   'canceled'  — user canceled or downgraded to Aware
--   'unpaid'    — Stripe gave up after dunning (set by Phase 3 webhook)
--
-- Deliberate choice: no DEFAULT clause. A brand-new Aware circle should not
-- start with billing_status='trial' (it has no Stripe relationship). The
-- column is populated when a billing event occurs.
--
-- Backfill at the bottom: any existing Prepared circle with trial_started_at
-- set but no billing_status — that's a member who started a trial before
-- this migration shipped. Stamp them as 'trial' so the trial status bar
-- and expired interstitial behave correctly.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE...WHERE billing_status IS NULL.
-- ============================================================================

alter table family_circles
  add column if not exists stripe_customer_id      text,
  add column if not exists stripe_subscription_id  text,
  add column if not exists billing_status          text,
  add column if not exists payment_method_last4    text,
  add column if not exists payment_method_brand    text,
  add column if not exists current_period_end      timestamptz;

comment on column family_circles.billing_status is
  'NULL | trial | active | past_due | canceled | unpaid. NULL means no Stripe relationship.';

-- One-shot backfill. Subsequent runs see no rows because the WHERE clause
-- excludes anything already stamped.
update family_circles
   set billing_status = 'trial'
 where subscription_tier = 'prepared'
   and trial_started_at is not null
   and billing_status is null;
