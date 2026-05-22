-- ============================================================================
-- NoWorry Home — Migration 036: home_visits + visit_checklist_items
-- Run order: ..., 035_welcome_home_assessment.sql, then 036.
-- Depends on is_active_staff() (027), is_active_hometech() (034).
--
-- Quarterly Home Care Visit records:
--   home_visits          — one row per visit
--   visit_checklist_items — one row per item completed during the visit
--
-- The checklist template lives client-side (src/lib/quarterlyChecklist.js
-- versioned constant) — keeping it out of the existing
-- maintenance_templates table avoids conflating two different domains
-- (recurring-task generation vs. visit walk-through). The
-- template_item_id column is reserved for a future link if we ever
-- want to wire checklist items to specific template rows.
--
-- Also adds homes.health_score so the visit submit flow can update it.
--
-- Idempotent throughout.
-- ============================================================================


-- ── 1. homes.health_score (0-100, default 100 = perfect) ───────────────────
alter table homes
  add column if not exists health_score integer default 100;

comment on column homes.health_score is
  '0-100 indicator. Defaults to 100. Adjusted by quarterly visits: +5 visit base, -1 per monitor item, -2 per address_soon, -5 per urgent. Capped [0,100].';


-- ── 2. home_visits ──────────────────────────────────────────────────────────
create table if not exists home_visits (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  home_id               uuid not null references homes(id) on delete cascade,
  circle_id             uuid not null references family_circles(id) on delete cascade,

  visit_type            text not null default 'quarterly',
  visit_date            date not null default current_date,

  tech_id               uuid references auth.users(id),
  tech_name             text,

  checklist_version     text,

  status                text not null default 'in_progress',

  items_checked         integer default 0,
  items_flagged         integer default 0,
  items_completed       integer default 0,

  health_score_before   integer,
  health_score_after    integer,

  report_pdf_path       text,
  report_sent_at        timestamptz,
  report_sent_to        text[],

  notes                 text
);

create index if not exists idx_home_visits_home   on home_visits(home_id);
create index if not exists idx_home_visits_circle on home_visits(circle_id);
create index if not exists idx_home_visits_date   on home_visits(visit_date desc);


-- ── 3. visit_checklist_items ────────────────────────────────────────────────
create table if not exists visit_checklist_items (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),

  visit_id              uuid not null references home_visits(id) on delete cascade,
  template_item_id      uuid,

  item_title            text not null,
  item_category         text,

  result                text not null default 'pending',
  severity              text,

  notes                 text,
  photo_path            text,

  completed_on_visit    boolean default false
);

create index if not exists idx_visit_items_visit on visit_checklist_items(visit_id);


-- ── 4. RLS — home_visits ───────────────────────────────────────────────────
alter table home_visits enable row level security;

drop policy if exists "Circle members read own visits"  on home_visits;
drop policy if exists "Staff read all visits"           on home_visits;
drop policy if exists "HomeTech write visits"           on home_visits;
drop policy if exists "HomeTech update visits"          on home_visits;

create policy "Circle members read own visits"
  on home_visits for select
  using (
    exists (
      select 1
        from circle_memberships cm
        join persons p on p.id = cm.person_id
       where cm.circle_id = home_visits.circle_id
         and p.auth_id = auth.uid()
         and cm.status = 'active'
    )
  );

create policy "Staff read all visits"
  on home_visits for select
  using (
    public.is_active_staff(array['owner','staff','readonly'])
    or public.is_active_hometech()
  );

create policy "HomeTech write visits"
  on home_visits for insert
  with check (
    public.is_active_hometech()
    or public.is_active_staff(array['owner','staff'])
  );

create policy "HomeTech update visits"
  on home_visits for update
  using (
    public.is_active_hometech()
    or public.is_active_staff(array['owner','staff'])
  );


-- ── 5. RLS — visit_checklist_items ─────────────────────────────────────────
alter table visit_checklist_items enable row level security;

drop policy if exists "Circle members read own items"  on visit_checklist_items;
drop policy if exists "Staff read all items"           on visit_checklist_items;
drop policy if exists "HomeTech write items"           on visit_checklist_items;
drop policy if exists "HomeTech update items"          on visit_checklist_items;

create policy "Circle members read own items"
  on visit_checklist_items for select
  using (
    exists (
      select 1
        from home_visits hv
        join circle_memberships cm on cm.circle_id = hv.circle_id
        join persons p on p.id = cm.person_id
       where hv.id = visit_checklist_items.visit_id
         and p.auth_id = auth.uid()
         and cm.status = 'active'
    )
  );

create policy "Staff read all items"
  on visit_checklist_items for select
  using (
    public.is_active_staff(array['owner','staff','readonly'])
    or public.is_active_hometech()
  );

create policy "HomeTech write items"
  on visit_checklist_items for insert
  with check (
    public.is_active_hometech()
    or public.is_active_staff(array['owner','staff'])
  );

create policy "HomeTech update items"
  on visit_checklist_items for update
  using (
    public.is_active_hometech()
    or public.is_active_staff(array['owner','staff'])
  );


-- ── 6. visit-reports storage bucket ────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('visit-reports', 'visit-reports', false)
on conflict (id) do nothing;

drop policy if exists "Staff read visit reports"    on storage.objects;
drop policy if exists "HomeTech upload reports"     on storage.objects;
drop policy if exists "Circle read visit reports"   on storage.objects;

create policy "Staff read visit reports"
  on storage.objects for select
  using (
    bucket_id = 'visit-reports'
    and (
      public.is_active_hometech()
      or public.is_active_staff(array['owner','staff','readonly'])
    )
  );

create policy "HomeTech upload reports"
  on storage.objects for insert
  with check (
    bucket_id = 'visit-reports'
    and public.is_active_hometech()
  );


-- ── 7. get_home_visits RPC ─────────────────────────────────────────────────
-- Returns the last 20 visits for a home. SECURITY DEFINER + auth check so
-- the function can be called by anyone authenticated; staff/hometech see
-- all visits, circle members see only their own (matched via RLS-style
-- subquery on the underlying table).

create or replace function public.get_home_visits(p_home_id uuid)
returns table (
  id                uuid,
  visit_date        date,
  visit_type        text,
  tech_name         text,
  status            text,
  items_checked     integer,
  items_flagged     integer,
  report_pdf_path   text,
  report_sent_at    timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select hv.id,
         hv.visit_date,
         hv.visit_type,
         hv.tech_name,
         hv.status,
         hv.items_checked,
         hv.items_flagged,
         hv.report_pdf_path,
         hv.report_sent_at
    from home_visits hv
   where hv.home_id = p_home_id
     and (
       public.is_active_staff(array['owner','staff','readonly'])
       or public.is_active_hometech()
       or exists (
         select 1
           from circle_memberships cm
           join persons p on p.id = cm.person_id
          where cm.circle_id = hv.circle_id
            and p.auth_id = auth.uid()
            and cm.status = 'active'
       )
     )
   order by hv.visit_date desc
   limit 20;
$$;

revoke execute on function public.get_home_visits(uuid) from public;
grant  execute on function public.get_home_visits(uuid) to authenticated;
