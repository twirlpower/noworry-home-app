-- ============================================================================
-- NoWorry Home — Migration 009: RLS policies for tasks
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            006 seasonal, 007 notif_prefs_rls, 008 tier_rename, then 009.
--
-- tasks had RLS enabled in 001 but no client policy. v1's matrix comment
-- (rls_policies_v1.sql L14, L274) places task access for Service Partner /
-- Helper at "Tasks Only" — they see *only* tasks assigned to them, never the
-- full circle backlog. Family-read roles see everything in their circle;
-- Family-write roles author tasks; assignees can update their own task to
-- mark it complete. No DELETE policy — soft-cancel via status='cancelled'
-- (matches the home_systems / notification_preferences pattern).
-- Helper functions current_person_id() / is_active_member() / has_circle_role()
-- come from 002.
-- ============================================================================

-- SELECT --------------------------------------------------------------------
-- Family-read roles: home_owner, circle_manager, care_partner, family_member,
-- trusted_advisor see every task in the circle. Service Partner / Helper
-- ("Tasks Only") see only tasks assigned to them.
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner',
          'family_member','trusted_advisor']::circle_role[]
  )
  or (
    public.has_circle_role(circle_id, array['service_partner','helper']::circle_role[])
    and assigned_to = public.current_person_id()
  )
);

-- INSERT --------------------------------------------------------------------
-- Authorship belongs to Family-write roles (matches home_systems_insert).
-- created_by must be the acting person — prevents spoofing on behalf of
-- someone else, even within the same circle.
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
  and created_by = public.current_person_id()
);

-- UPDATE --------------------------------------------------------------------
-- Family-write roles can edit any task in the circle. Assignees (any role,
-- including Helper / Service Partner / Family Member) can update the task
-- they own — this is what lets a Helper mark their assignment complete
-- without needing INSERT rights. with_check mirrors using to prevent moving
-- a task into a circle / assignee combination the editor wouldn't qualify
-- for after the update lands.
drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
using (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
  or assigned_to = public.current_person_id()
)
with check (
  public.has_circle_role(
    circle_id,
    array['home_owner','circle_manager','care_partner']::circle_role[]
  )
  or assigned_to = public.current_person_id()
);

-- No DELETE policy. Cancelling is a status transition (status='cancelled'),
-- which leaves audit + history intact. Matches the soft-state pattern used
-- elsewhere (home_systems.is_active, no notification_preferences delete).
