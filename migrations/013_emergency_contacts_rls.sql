-- ============================================================================
-- NoWorry Home — Migration 013: RLS policies for emergency_contacts
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, 007 notif_prefs_rls, 008 tier_rename, 009 tasks_rls,
--            010 documents_rls, 011 trial_tracking, 012 trial_emails_sent,
--            then 013.
--
-- emergency_contacts had RLS enabled in 001 (schema v1.0 L589) but no client
-- policy → deny-all. Reads available to any active circle member (Family-read
-- via is_active_member); writes restricted to Family-write roles
-- (home_owner, circle_manager, care_partner) — same matrix used by
-- tasks_insert / documents_insert.
--
-- Spec proposed circle_manager-only for writes; widened to Family-write here
-- for matrix consistency (a care_partner often maintains a parent's
-- contacts on their behalf). Easy to tighten later if abuse shows up.
--
-- Hard DELETE is allowed — emergency_contacts has no is_archived column, so
-- there's no soft-delete path. Use status='inactive' on the membership or
-- restore from backup if you need to recover a deletion.
--
-- Helper functions come from rls_policies_v1.sql.
-- Idempotent via DROP POLICY IF EXISTS.
-- ============================================================================

drop policy if exists emergency_contacts_select on emergency_contacts;
create policy emergency_contacts_select on emergency_contacts for select using (
  public.is_active_member(circle_id)
);

drop policy if exists emergency_contacts_insert on emergency_contacts;
create policy emergency_contacts_insert on emergency_contacts for insert with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
);

drop policy if exists emergency_contacts_update on emergency_contacts;
create policy emergency_contacts_update on emergency_contacts for update
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

drop policy if exists emergency_contacts_delete on emergency_contacts;
create policy emergency_contacts_delete on emergency_contacts for delete using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
);
