-- ============================================================================
-- NoWorry Home — Migration 054: stripe_webhook_events (webhook idempotency log)
-- Run order: ..., 053_drop_legacy_emergency_contacts_policy.sql, then 054.
--
-- Backs api/stripe/webhook.mjs (Phase 3 real handlers). Stripe delivers each
-- event at-least-once and retries on any non-2xx — so a handler MUST be
-- idempotent. The webhook records every event it processes here, keyed by the
-- Stripe event id (UNIQUE). Before applying any DB mutation the handler checks
-- for an existing stripe_event_id; a hit means "already processed, skip".
--
-- Note on the original spec: this was specced as "migration 052". 052 and 053
-- were already taken (052_handle_new_user_email_conflict, 053_drop_legacy_*),
-- and migrations live in migrations/ (not docs/migrations/), so it ships as
-- 054 in the canonical folder.
--
-- payload: the full Stripe event object (jsonb) for audit/debugging. Kept
-- small in practice (one event) and never read by the app at runtime.
--
-- RLS: enabled with NO policies. The table is written ONLY by the webhook
-- using the Supabase service role, which bypasses RLS. With RLS on and no
-- policy, every anon/authenticated client read or write is denied — exactly
-- the intent (this is internal billing plumbing, never member-facing).
--
-- Idempotent: CREATE TABLE / ENABLE RLS IF guards make this safe to re-run.
-- ============================================================================

create table if not exists public.stripe_webhook_events (
  id              uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  event_type      text not null,
  processed_at    timestamptz not null default now(),
  payload         jsonb
);

comment on table public.stripe_webhook_events is
  'Idempotency + audit log for Stripe webhook deliveries. Written only by '
  'api/stripe/webhook.mjs via the service role. stripe_event_id UNIQUE is the '
  'idempotency key — a present row means the event was already processed.';

-- Speeds up the per-event idempotency check (the UNIQUE constraint already
-- creates a btree on stripe_event_id, so no extra index is needed there).

alter table public.stripe_webhook_events enable row level security;

-- Deliberately NO policies: service-role writes bypass RLS; everyone else is
-- denied. Do not add member-facing policies — this table is server-only.
