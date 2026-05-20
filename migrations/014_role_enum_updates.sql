-- ============================================================================
-- NoWorry Home — Migration 014: add care_coordinator and view_only to
--                                the circle_role enum
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, 007 notif_prefs_rls, 008 tier_rename, 009 tasks_rls,
--            010 documents_rls, 011 trial_tracking, 012 trial_emails_sent,
--            013 emergency_contacts_rls, then 014.
--
-- Background: the v1.5 onboarding invite step (commit c9d2824) shows
-- "Care Coordinator" and "View Only" in the UI but writes care_partner /
-- trusted_advisor to the DB because those new enum values didn't exist
-- yet. This migration adds them so the UI labels can map 1:1 to the
-- enum at insert time.
--
-- IF NOT EXISTS makes each statement idempotent — safe to re-run.
-- Existing care_partner / trusted_advisor rows are untouched.
--
-- IMPORTANT — RLS POLICIES NOT UPDATED HERE.
-- Every Family-write RLS policy still hardcodes 'care_partner' (see
-- circles_update in rls_policies_v1.sql L204, plus 007/009/010/013).
-- A member assigned 'care_coordinator' can be invited, sign in, and
-- READ data, but cannot INSERT/UPDATE/DELETE through those policies
-- yet. Treat care_coordinator as a read-tier role until a follow-up
-- migration adds it to the Family-write check arrays.
-- ============================================================================

alter type circle_role add value if not exists 'care_coordinator';
alter type circle_role add value if not exists 'view_only';
