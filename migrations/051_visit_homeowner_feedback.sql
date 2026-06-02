-- ============================================================================
-- NoWorry Home — Migration 051: homeowner post-visit feedback
-- Run order: ..., 050_aware_emails_sent.sql, then 051.
-- Depends on is_active_staff() (027), is_active_hometech() (034), and the
-- home_visits table + RLS from 036.
--
-- Adds a one-tap homeowner rating + optional comment to home_visits, plus the
-- RLS and a column-guard trigger so a homeowner can write ONLY the three
-- feedback columns on their own circle's visits (never score/status/etc).
--
-- Idempotent throughout.
-- ============================================================================

-- ── 1. Columns ───────────────────────────────────────────────────────────────
alter table home_visits
  add column if not exists homeowner_rating     smallint
    constraint home_visits_homeowner_rating_chk check (homeowner_rating in (1, 2, 3)),
  add column if not exists homeowner_feedback    text,
  add column if not exists homeowner_feedback_at timestamptz;

comment on column home_visits.homeowner_rating is
  '1 = needs attention, 2 = good, 3 = great. NULL = no feedback given yet.';
comment on column home_visits.homeowner_feedback is
  'Optional free-text comment. Length capped at 500 chars client-side.';

-- ── 2. RLS — homeowner may UPDATE their own circle's visits ───────────────────
-- Row scope only (see trigger below for column scope). home_owner /
-- circle_manager active members of the visit's circle, AND only when they are
-- the actual homeowner (relationship_kind = 'self') — an adult child managing
-- a parent's home (relationship_kind = 'adult_child') cannot submit feedback.
drop policy if exists "Homeowner feedback update" on home_visits;
create policy "Homeowner feedback update"
  on home_visits for update
  using (
    exists (
      select 1
        from circle_memberships cm
        join persons p on p.id = cm.person_id
       where cm.circle_id = home_visits.circle_id
         and p.auth_id = auth.uid()
         and cm.status = 'active'
         and cm.role in ('home_owner', 'circle_manager')
         and cm.relationship_kind = 'self'
    )
  )
  with check (
    exists (
      select 1
        from circle_memberships cm
        join persons p on p.id = cm.person_id
       where cm.circle_id = home_visits.circle_id
         and p.auth_id = auth.uid()
         and cm.status = 'active'
         and cm.role in ('home_owner', 'circle_manager')
         and cm.relationship_kind = 'self'
    )
  );

-- (Read access is unchanged — the existing "Circle members read own visits"
--  policy from 036 already covers homeowners reading their visits.)

-- ── 3. Column guard — non-staff may change ONLY the feedback columns ──────────
create or replace function public.guard_home_visit_feedback_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Staff / hometech keep full update rights (report flow, status, scoring).
  if public.is_active_hometech()
     or public.is_active_staff(array['owner', 'staff']) then
    return new;
  end if;

  -- Everyone else (homeowners via the policy above) may only touch the three
  -- feedback columns. Strip the allowed keys from both row images and compare
  -- the remainder — if anything else changed, reject.
  if (to_jsonb(new) - array['homeowner_rating', 'homeowner_feedback', 'homeowner_feedback_at', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['homeowner_rating', 'homeowner_feedback', 'homeowner_feedback_at', 'updated_at'])
  then
    raise exception 'home_visits: only homeowner feedback columns may be updated by non-staff';
  end if;

  return new;
end$$;

drop trigger if exists trg_guard_home_visit_feedback on home_visits;
create trigger trg_guard_home_visit_feedback
  before update on home_visits
  for each row
  execute function public.guard_home_visit_feedback_update();
