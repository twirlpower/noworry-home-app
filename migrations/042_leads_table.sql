-- ============================================================================
-- NoWorry Home — Migration 042: leads (marketing-site form capture)
-- Run order: ..., 041_drop_legacy_pillar2_policies.sql, then 042.
-- Depends on: staff_accounts (migration 018), persons (schema v1.0).
--
-- Plugs the lead-capture hole: marketing-site forms currently send email
-- only. A missed email = a lost lead. This table is the source of truth
-- for every submission. The Edge Function in the noworry-home-site repo
-- writes here under the service role key, then notifies via Resend.
--
-- Why a separate table from crm_contacts:
--   crm_contacts is a hand-entered founder prospect list (sources:
--   Personal Network / Referral Partner / Cold). It has no spam scoring,
--   no IP hash, no payload bag, no per-form metadata, and is curated
--   one-by-one. Leads is bot-exposed, auto-captured, untrusted, and
--   needs spam + rate-limit infrastructure. On triage a lead either
--   gets dropped (spam / declined), converted into a typed CRM row
--   (vendor / partner / prospect), or itself becomes a customer.
--
-- RLS — copy of the staff_accounts pattern from migration 025
--   The spec draft used `persons.id = auth.uid()` which is a silent RLS
--   bug in this codebase (auth.uid() is the auth user UUID, persons.id
--   is the persons PK — they never match; the policy would deny
--   everyone). Same trap migration 039's header warns about. Gate via
--   staff_accounts.user_id = auth.uid() instead, exactly like
--   crm_contacts / crm_partners / vendors do today.
--
-- Idempotent.
-- ============================================================================

-- ── enums ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_type') then
    create type lead_type as enum (
      'homeowner_signup',
      'vendor_application',
      'partner_inquiry',
      'general_contact'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type lead_status as enum (
      'new',
      'contacted',
      'qualified',
      'converted',
      'declined',
      'spam'
    );
  end if;
end$$;


-- ── table ──────────────────────────────────────────────────────────────────
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  lead_type       lead_type not null,
  status          lead_status not null default 'new',

  name            text,
  email           text,
  phone           text,
  zip             text,
  message         text,

  -- Per-form fields (vendor.category, partner.profession, etc.) live here
  -- so we don't add a column every time the marketing site adds a question.
  payload         jsonb not null default '{}'::jsonb,

  source_page     text,
  source_url      text,
  user_agent      text,
  ip_hash         text,
  referrer        text,

  spam_score      integer default 0,
  spam_flags      jsonb default '[]'::jsonb,

  assigned_to     uuid references persons(id),
  notes           text,
  contacted_at    timestamptz,
  converted_at    timestamptz,
  converted_to    text,  -- 'vendor' | 'crm_partner' | 'crm_contact' — what we
                         -- created on conversion, for audit
  converted_id    uuid,  -- id of the created row

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_leads_status  on leads(status);
create index if not exists idx_leads_type    on leads(lead_type);
create index if not exists idx_leads_created on leads(created_at desc);
create index if not exists idx_leads_email   on leads(email) where email is not null;

comment on table leads is
  'Marketing-site form submissions. Written by the noworry-home-site Edge Function under service role. Triaged from /admin/crm Leads tab.';


-- ── updated_at trigger ─────────────────────────────────────────────────────
create or replace function public.update_leads_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at
  before update on leads
  for each row execute function public.update_leads_updated_at();


-- ── RLS — staff_accounts gated, same pattern as crm_contacts ───────────────
-- Service role (Edge Function inserts) bypasses RLS automatically — no
-- policy needed for inserts. The four policies below cover authenticated
-- staff reading + triaging from the dashboard.
alter table leads enable row level security;

drop policy if exists "Staff read leads"   on leads;
drop policy if exists "Staff write leads"  on leads;
drop policy if exists "Staff update leads" on leads;
drop policy if exists "Staff delete leads" on leads;

create policy "Staff read leads"
  on leads for select
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff','readonly')
    )
  );

-- INSERT for authenticated staff (e.g., manual lead entry from the
-- dashboard). The Edge Function uses service role and bypasses this.
create policy "Staff write leads"
  on leads for insert
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff update leads"
  on leads for update
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  )
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );

create policy "Staff delete leads"
  on leads for delete
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.role in ('owner','staff')
    )
  );
