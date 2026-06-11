-- Migration 053: Drop superseded legacy policy on emergency_contacts
--
-- Audit finding (Phase 2 security audit, June 2026):
-- 'circle_manager_write_emergency_contacts' is an ALL-command policy covering
-- only circle_manager. It is fully superseded by four granular policies:
--   - emergency_contacts_select  (SELECT)
--   - emergency_contacts_insert  (INSERT)
--   - emergency_contacts_update  (UPDATE)
--   - emergency_contacts_delete  (DELETE)
-- The granular policies cover home_owner, circle_manager, care_partner, and
-- care_coordinator — a strict superset of the legacy policy's coverage
-- (confirmed against the live emergency_contacts_insert with_check). Dropping
-- eliminates silent OR-stacking and clarifies enforced access.
--
-- Idempotent: DROP POLICY IF EXISTS is safe to re-run.

DROP POLICY IF EXISTS "circle_manager_write_emergency_contacts"
  ON public.emergency_contacts;
