-- ============================================================================
-- NoWorry Home — Migration 010: documents (bucket + table RLS + storage RLS)
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, 007 notif_prefs_rls, 008 tier_rename, 009 tasks_rls,
--            then 010.
--
-- Self-contained: one apply of this file provisions the 'documents' bucket,
-- the documents-table policies, AND the storage.objects policies that scope
-- object access by circle. No dashboard click required.
--
-- Object key convention enforced by both layers:
--     '<circle_id>/<uuid>-<sanitized-filename>'
-- The first folder segment IS the circle_id — that's how storage.objects
-- policies recover the scope from the path.
--
-- Permission matrix (matches the Family Graph spec; same role sets used by
-- circles_update and tasks_insert):
--   read   — Family-read: home_owner, circle_manager, care_partner,
--            family_member, trusted_advisor
--   write  — Family-write: home_owner, circle_manager, care_partner
-- Service Partner and Helper have NO access to The Plan pillar — they
-- intentionally don't appear in either set.
-- ============================================================================

-- ── 1. PROVISION THE BUCKET ─────────────────────────────────────────────────
-- Private bucket (public=false), 25 MiB per file, narrow MIME allow-list for
-- the documents people actually scan/upload (PDFs and phone-camera images).
-- ON CONFLICT keeps the migration idempotent — re-runs are no-ops.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400,                                       -- 25 MiB
  array['application/pdf','image/jpeg','image/png','image/heic']::text[]
)
on conflict (id) do nothing;


-- ── 2. TABLE-LEVEL RLS: public.documents ────────────────────────────────────
-- The metadata row. file_path is just text — it doesn't grant file access
-- by itself; the storage.objects policies in section 3 gate the bytes.

drop policy if exists documents_select on documents;
create policy documents_select on documents for select using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner',
          'family_member','trusted_advisor']::circle_role[]
  )
);

-- uploaded_by must be the acting person — prevents spoofing on behalf of
-- someone else, same pattern as tasks_insert.
drop policy if exists documents_insert on documents;
create policy documents_insert on documents for insert with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
  and uploaded_by = public.current_person_id()
);

-- UPDATE covers metadata edits and the is_archived soft-delete toggle.
drop policy if exists documents_update on documents;
create policy documents_update on documents for update
using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
)
with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
);

-- No DELETE policy — soft-archive via is_archived=true (matches the
-- home_systems / notification_preferences / tasks soft-state pattern).


-- ── 3. STORAGE-LEVEL RLS: storage.objects, bucket='documents' ───────────────
-- storage.foldername(name) returns the path as text[]; element 1 is the
-- first segment (the circle_id). Casting to uuid both filters obvious
-- malformed paths and lets has_circle_role / is_active_member do their
-- normal lookups.

drop policy if exists documents_bucket_read on storage.objects;
create policy documents_bucket_read on storage.objects for select
to authenticated using (
  bucket_id = 'documents'
  and public.has_circle_role(
    ((storage.foldername(name))[1])::uuid,
    array['home_owner','circle_manager','care_partner',
          'family_member','trusted_advisor']::circle_role[]
  )
);

drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects for insert
to authenticated with check (
  bucket_id = 'documents'
  and public.has_circle_role(
    ((storage.foldername(name))[1])::uuid,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
);

-- DELETE on storage.objects is wired even though the table soft-archives:
-- a failed metadata-insert path in the upload helper removes the orphaned
-- file (see src/lib/documents.js → uploadDocument), and an explicit hard-
-- delete from Family-write roles stays possible if we add one later.
drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete on storage.objects for delete
to authenticated using (
  bucket_id = 'documents'
  and public.has_circle_role(
    ((storage.foldername(name))[1])::uuid,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
);
