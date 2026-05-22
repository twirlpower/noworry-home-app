-- ============================================================================
-- NoWorry Home — Migration 019: add care_coordinator to documents write policies
-- Run order: ..., 010_documents_rls.sql, ..., 018_staff_accounts.sql, then 019.
--
-- Scope: TABLE-level documents writes only. Adds 'care_coordinator' to the
-- INSERT and UPDATE role arrays so a care coordinator can upload to and
-- archive items from the Plan vault. Mirrors the role-set decisions made
-- in migration 015 for other Plan-pillar tables.
--
-- NOT changed by this migration:
--   * documents SELECT (read) — unchanged, still uses the Family-read array
--   * storage.objects policies on the 'documents' bucket — those still use
--     the original Family-write set from 010. If we want care_coordinator
--     to upload bytes (not just rows), we'd extend 010's storage policies
--     too. Today, an INSERT to the documents table without a matching
--     storage upload is meaningless, so widening just the table policies
--     here is intentionally conservative — a follow-up migration can
--     extend storage.objects once we're sure care_coordinator should
--     touch raw bytes.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE.
-- ============================================================================

drop policy if exists documents_insert on documents;
create policy documents_insert on documents for insert with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
  and uploaded_by = public.current_person_id()
);

drop policy if exists documents_update on documents;
create policy documents_update on documents for update
using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
)
with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
);
