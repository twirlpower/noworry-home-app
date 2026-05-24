-- ============================================================================
-- NoWorry Home — Migration 041: drop legacy Pillar 2 SELECT policies orphaned
--                                by migrations 039/040
-- Run order: ..., 039_pillar2_role_lockdown.sql, 040_trusted_advisor_grants.sql,
--            then 041.
--
-- Bug discovered during Phase 3.5 verification testing:
--
--   Migration 039 added a new emergency_contacts_select policy via
--   `DROP POLICY IF EXISTS emergency_contacts_select` followed by
--   `CREATE POLICY emergency_contacts_select`. But the actual broad
--   pre-existing policy on this table was named
--   `circle_members_read_emergency_contacts` — created out-of-band before
--   migration 013 (it is not in any tracked migration). The DROP targeted
--   a name that didn't exist and dropped nothing; the CREATE added the
--   new role-gated policy ALONGSIDE the legacy one.
--
--   Postgres evaluates multiple permissive RLS SELECT policies with OR.
--   So even with the new role-gated policy in place, the broad legacy
--   policy continued to allow service_partner and helper to read
--   emergency_contacts — silently bypassing the Phase 3.5 lockdown.
--
--   Verified manually in Supabase: dropping the legacy policy made
--   service_partner correctly lose read access. This migration codifies
--   the fix.
--
-- Lesson: when tightening an existing RLS policy, query pg_policies first
-- to discover the ACTUAL policy names, then DROP by real name — never
-- trust that a DROP IF EXISTS by spec-name will clean up what's really
-- there. A spec-name-only DROP only works for policies that this codebase
-- itself created.
--
-- Scope of this migration:
--   * emergency_contacts — drop confirmed-orphaned legacy policy
--   * documents          — verification block only (no orphan confirmed,
--                          but documents was tightened by the same 039 +
--                          040 sequence and should be checked)
--
-- Investigation notes:
--   No other Pillar 2 SELECT policies with non-spec names appear in
--   tracked migrations (013, 010, 015, 016, 019, 039, 040). Any further
--   orphans would also be out-of-band artifacts. The DO block below
--   raises WARNING if either table ends up with more than one SELECT
--   policy after this migration runs, which would surface any further
--   orphan we don't know about. Run this against pg_policies to confirm
--   before assuming the Pillar 2 surface is clean:
--
--     select tablename, policyname, cmd
--     from pg_policies
--     where tablename in ('emergency_contacts','documents')
--       and cmd = 'SELECT';
--
-- Idempotent.
-- ============================================================================

begin;

-- ── emergency_contacts — drop the legacy out-of-band policy ────────────────
drop policy if exists circle_members_read_emergency_contacts on emergency_contacts;

-- ── Verification block ─────────────────────────────────────────────────────
-- After this migration, both Pillar 2 tables should have exactly one SELECT
-- policy each: emergency_contacts_select (from 040) and documents_select
-- (from 040). Anything else is an orphan that needs investigation.
do $$
declare
  ec_count   int;
  ec_names   text;
  doc_count  int;
  doc_names  text;
begin
  select count(*), string_agg(policyname, ', ')
  into ec_count, ec_names
  from pg_policies
  where tablename = 'emergency_contacts' and cmd = 'SELECT';

  raise notice 'SELECT policies on emergency_contacts: % (%)', ec_count, ec_names;

  if ec_count != 1 then
    raise warning 'Expected exactly 1 SELECT policy on emergency_contacts. Found %: %', ec_count, ec_names;
  end if;

  select count(*), string_agg(policyname, ', ')
  into doc_count, doc_names
  from pg_policies
  where tablename = 'documents' and cmd = 'SELECT';

  raise notice 'SELECT policies on documents: % (%)', doc_count, doc_names;

  if doc_count != 1 then
    raise warning 'Expected exactly 1 SELECT policy on documents. Found %: %', doc_count, doc_names;
  end if;
end $$;

commit;
