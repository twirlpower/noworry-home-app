-- ============================================================================
-- NoWorry Home — Migration 011: trial tracking columns on family_circles
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, 007 notif_prefs_rls, 008 tier_rename, 009 tasks_rls,
--            010 documents_rls, then 011.
--
-- Backs the Aware → Prepared trial flip wired in Dashboard.handleStartTrial:
-- when a user clicks "Try Prepared free for 30 days" the app sets
-- subscription_tier='prepared' AND stamps both columns. Days-remaining UI
-- and (later) the cron/Stripe-webhook downgrade-on-expiry read trial_ends_at.
-- Spec said `circles`; real table is `family_circles`.
-- Both columns nullable — null means "no trial has been started".
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- No new RLS needed — circles_update (rls_policies_v1.sql L204) already
-- gates writes to Family-write roles.
-- ============================================================================

alter table family_circles
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at    timestamptz;

comment on column family_circles.trial_started_at is
  'When the 30-day Prepared trial began. NULL = no trial started yet.';

comment on column family_circles.trial_ends_at is
  '30 days after trial_started_at. UI reads this for days-remaining and a '
  'future job will downgrade subscription_tier back to ''aware'' on expiry.';
