-- ============================================================================
-- NoWorry Home — Migration 031: widen notes INSERT to include family_member
-- Run order: ..., 030_admin_crm_overhaul.sql, then 031.
--
-- Migration 020 restricted the Family Notes feed's INSERT policy to the
-- Family-write role set. The core notes use case — adult child leaving a
-- note for a parent — is squarely the family_member role, which has been
-- locked out of posting since 020 shipped.
--
-- This widens the role array by one entry. Read access already included
-- family_member from 020. Service Partner, Helper, Trusted Advisor, and
-- View Only stay excluded from INSERT — they either can't see notes
-- (service_partner/helper aren't in the SELECT array) or are read-only
-- by definition (view_only, trusted_advisor).
--
-- Preserves the author_id = current_person_id() anti-spoofing check from
-- 020. Without it, any allowed role could insert a note attributed to
-- another circle member — undoing the trust the append-only model is
-- supposed to provide.
--
-- Idempotent: drops every plausible policy name (including the canonical
-- one and the speculative names from the task spec) before recreating.
-- ============================================================================

drop policy if exists notes_insert              on notes;
drop policy if exists "Care roles insert notes" on notes;
drop policy if exists "Family write insert notes" on notes;
drop policy if exists "Family insert notes"     on notes;

create policy notes_insert on notes for insert with check (
  public.has_circle_role(
    circle_id,
    array[
      'home_owner',
      'circle_manager',
      'care_partner',
      'care_coordinator',
      'family_member'
    ]::circle_role[]
  )
  and author_id = public.current_person_id()
);

-- No UPDATE policy. No DELETE policy. Notes remain append-only.
