-- ============================================================================
-- NoWorry Home — Migration 021: Supabase security-linter fixes
-- Run order: ..., 020_notes_rls.sql, then 021.
--
-- Scope: function-grant tightening + mutable-search-path fix. No app code
-- changes are needed for any of these.
--
-- Layout:
--   PART A — verbatim from the task spec
--   PART B — additional PUBLIC-revokes that should actually clear the
--            Supabase linter warnings if Part A turns out to be a no-op
--
-- Why two parts: `REVOKE EXECUTE ... FROM anon` only removes a grant if
-- `anon` was granted directly. By default, Postgres grants EXECUTE on
-- new functions to PUBLIC. `anon` (a real role) then inherits EXECUTE
-- via PUBLIC, and `REVOKE FROM anon` does nothing. The reliable fix is
-- `REVOKE EXECUTE FROM PUBLIC` plus an explicit `GRANT EXECUTE TO
-- authenticated` where the function should still be callable. Trigger
-- functions don't need any GRANT — trigger execution bypasses EXECUTE
-- privilege checks. See https://www.postgresql.org/docs/current/sql-revoke.html
-- and Supabase auth-helpers grant patterns.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + REVOKE/GRANT are all safe to
-- re-run. REVOKE on a privilege that doesn't exist is a no-op.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- PART A — verbatim from the task spec
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Lock down search_path on update_updated_at.
-- Original definition (schema v1.0 L543) had no SET search_path, which is
-- what the linter flags. Adding SET search_path = public closes the
-- search-path-injection vector. SECURITY DEFINER per spec — for this
-- trigger function the effect is benign (it only sets NEW.updated_at).
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. Restrict add_staff_account to authenticated only.
-- (Migration 018 already did REVOKE ALL FROM PUBLIC + GRANT TO authenticated,
-- so this is belt-and-suspenders. Kept verbatim per spec.)
REVOKE EXECUTE ON FUNCTION public.add_staff_account(
  p_email text,
  p_name  text,
  p_role  text,
  p_notes text
) FROM anon;

-- 3. Restrict setup_home_circle to authenticated only.
-- Onboarding requires a signed-in user; anon access is not needed.
REVOKE EXECUTE ON FUNCTION public.setup_home_circle(
  p_setup_type         text,
  p_circle_name        text,
  p_home               jsonb,
  p_owner_first        text,
  p_owner_last         text,
  p_owner_relationship text
) FROM anon;

-- 4. handle_new_user is a trigger function on auth.users — never called
-- directly by API users. The revoke is defense-in-depth.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;


-- ────────────────────────────────────────────────────────────────────────────
-- PART B — PUBLIC-revoke belt-and-suspenders
--
-- These should be the actual fixes if Part A's REVOKE FROM anon didn't move
-- the needle on the linter (because anon was reaching EXECUTE via PUBLIC,
-- not via a direct grant). Authenticated users keep access via explicit
-- GRANT. Trigger functions get no GRANT — they don't need one.
-- ────────────────────────────────────────────────────────────────────────────

-- setup_home_circle: callable by signed-in users during onboarding.
REVOKE EXECUTE ON FUNCTION public.setup_home_circle(
  p_setup_type         text,
  p_circle_name        text,
  p_home               jsonb,
  p_owner_first        text,
  p_owner_last         text,
  p_owner_relationship text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.setup_home_circle(
  p_setup_type         text,
  p_circle_name        text,
  p_home               jsonb,
  p_owner_first        text,
  p_owner_last         text,
  p_owner_relationship text
) TO authenticated;

-- handle_new_user: trigger only — no GRANT TO authenticated needed because
-- trigger execution bypasses privilege checks. Removing PUBLIC EXECUTE
-- prevents anyone from calling it directly via the REST API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- add_staff_account is already locked down by migration 018. Re-asserting
-- the desired state here is harmless and keeps this migration the
-- single source of truth for the lockdown.
REVOKE EXECUTE ON FUNCTION public.add_staff_account(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_staff_account(text, text, text, text) TO authenticated;
