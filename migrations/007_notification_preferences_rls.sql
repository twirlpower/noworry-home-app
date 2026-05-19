-- ============================================================================
-- NoWorry Home — Migration 007: RLS policies for notification_preferences
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, then 007.
-- notification_preferences had RLS enabled in 001 but no client policy, so it
-- was deny-all (the Settings → Notifications panel could neither read nor
-- write). A person manages only their OWN preference rows, and only for a
-- circle they are an active member of. Idempotent: drops policies first.
-- Helper functions current_person_id() / is_active_member() come from 002.
-- ============================================================================

-- A person sees and edits only their own rows, scoped to circles they
-- actively belong to. No "manager edits someone else's prefs" — preferences
-- are personal even within a shared circle (matches the table comment intent).

drop policy if exists notif_prefs_select on notification_preferences;
create policy notif_prefs_select on notification_preferences for select using (
  person_id = public.current_person_id()
  and public.is_active_member(circle_id)
);

drop policy if exists notif_prefs_insert on notification_preferences;
create policy notif_prefs_insert on notification_preferences for insert with check (
  person_id = public.current_person_id()
  and public.is_active_member(circle_id)
);

drop policy if exists notif_prefs_update on notification_preferences;
create policy notif_prefs_update on notification_preferences for update
using   (person_id = public.current_person_id() and public.is_active_member(circle_id))
with check (person_id = public.current_person_id() and public.is_active_member(circle_id));

-- No delete policy: a row is muted/toggled, never hard-deleted from the client
-- (consistent with the soft-state pattern used elsewhere — e.g. home_systems).
