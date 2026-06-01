-- ============================================================================
-- NoWorry Home — Migration 050: family_circles.aware_emails_sent
-- Run order: ..., 049_path_b_homeowner_contact.sql, then 050.
--
-- Backing column for the Aware → Prepared conversion drip
-- (api/cron/send-aware-emails.mjs). Mirrors trial_emails_sent: a jsonb
-- map of { day_1: <iso>, day_7: ..., day_14: ..., day_30: ... } where a
-- present key means that drip email has been sent. Missing key = unsent.
--
-- Backfill guard: every existing circle (created before the campaign launch
-- on 2026-06-01) is pre-stamped with all four keys so the drip NEVER fires
-- for the pre-launch base. Combined with the cron's .gte('created_at', ...)
-- cutoff, this is belt-and-suspenders — only Aware signups from launch day
-- forward enter the sequence.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE only the still-empty '{}' rows.
-- ============================================================================

alter table family_circles
  add column if not exists aware_emails_sent jsonb not null default '{}'::jsonb;

comment on column family_circles.aware_emails_sent is
  'Aware→Prepared conversion drip send-stamps. { day_1|day_7|day_14|day_30: iso }. '
  'Present key = sent. Written only by api/cron/send-aware-emails.mjs. '
  'Pre-launch circles (created < 2026-06-01) are pre-stamped so they never enter the drip.';

-- Pre-stamp every circle created before launch so it can never receive the
-- sequence. Only touches rows still at the default '{}' so re-running the
-- migration is a no-op and never clobbers real send-stamps.
update family_circles
   set aware_emails_sent = jsonb_build_object(
         'day_1',  '2026-06-01T00:00:00Z',
         'day_7',  '2026-06-01T00:00:00Z',
         'day_14', '2026-06-01T00:00:00Z',
         'day_30', '2026-06-01T00:00:00Z'
       )
 where created_at < '2026-06-01T00:00:00Z'
   and aware_emails_sent = '{}'::jsonb;
