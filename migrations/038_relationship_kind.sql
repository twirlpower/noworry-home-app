-- ============================================================================
-- NoWorry Home — Migration 038: relationship_kind + gender + date_of_birth
-- Run order: ..., 037_billing_cycle.sql, then 038.
--
-- Adds structured relationship + identity fields so the circle switcher
-- and other UI can render personalized home labels ("Mom & Dad's House",
-- "Grandma's House"). The existing free-form `circle_memberships.relationship
-- text` column stays — it's still used by Circle.jsx for invite labels
-- like "daughter" / "neighbor" — so we add a NEW column `relationship_kind`
-- of an enum type rather than coerce the existing text column.
--
-- DEVIATIONS from the spec template:
--   - Spec said column name "relationship" (collides with existing text
--     column); using "relationship_kind".
--   - Spec said gender/dob on a "profiles" table; that doesn't exist here.
--     Adding to `persons` instead.
--   - Spec said the column should be NOT NULL DEFAULT 'other'. Keeping
--     it nullable so legacy rows that aren't homeowners stay NULL until
--     the app fills them in — avoids retroactively tagging every old
--     family_member / care_partner as 'other'.
--
-- Idempotent (CREATE TYPE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'relationship_type') then
    create type relationship_type as enum (
      'self',
      'spouse_partner',
      'adult_child',
      'grandchild',
      'sibling',
      'professional',
      'other'
    );
  end if;
end$$;

alter table circle_memberships
  add column if not exists relationship_kind relationship_type;

comment on column circle_memberships.relationship_kind is
  'Structured relationship for display-name personalization. NULL on legacy rows; new memberships from onboarding Path B set this.';

-- Backfill: existing homeowners + circle managers are speaking about
-- their own home. Path A self-setup gets 'self'.
update circle_memberships
   set relationship_kind = 'self'
 where relationship_kind is null
   and role in ('home_owner', 'circle_manager');


-- Gender + DOB on persons (no profiles table in this codebase).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'gender_type') then
    create type gender_type as enum (
      'she_her',
      'he_him',
      'they_them',
      'prefer_not_to_say'
    );
  end if;
end$$;

alter table persons
  add column if not exists gender        gender_type,
  add column if not exists date_of_birth date;

comment on column persons.gender is
  'Self-identified pronouns. Used to gender the personalized home display name (Mom vs Dad, Grandma vs Grandpa). Falls back to first_name when unset.';
comment on column persons.date_of_birth is
  'Reserved for cohort analytics. Collected now so it is available without re-prompting later.';
