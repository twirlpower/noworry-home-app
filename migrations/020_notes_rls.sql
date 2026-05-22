-- ============================================================================
-- NoWorry Home — Migration 020: RLS policies for notes (Family Notes feed)
-- Run order: ..., 019_documents_care_coordinator.sql, then 020.
--
-- The `notes` table (schema v1.0 L434) had RLS enabled in 001 but no client
-- policies → deny-all. This migration opens it up for the Family Notes feed
-- on the Tasks page.
--
-- Permission matrix:
--   read   — Family-read + view_only (matches the post-016 Family-read array
--            on tasks/documents/emergency_contacts)
--   write  — Family-write (home_owner, circle_manager, care_partner,
--            care_coordinator) — same set as tasks_insert / documents_insert.
--            author_id must equal the acting person — prevents spoofing on
--            behalf of someone else.
--   update — no policy. Notes are append-only by design (per the spec's
--            "no edit/delete on notes — keeps it simple and trustworthy").
--   delete — no policy. Same reasoning.
--
-- Helper functions come from rls_policies_v1.sql.
-- Idempotent via DROP POLICY IF EXISTS.
-- ============================================================================

drop policy if exists notes_select on notes;
create policy notes_select on notes for select using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator',
          'family_member','trusted_advisor','view_only']::circle_role[]
  )
);

drop policy if exists notes_insert on notes;
create policy notes_insert on notes for insert with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner','care_coordinator']::circle_role[]
  )
  and author_id = public.current_person_id()
);

-- No UPDATE policy. No DELETE policy. Notes are append-only.
