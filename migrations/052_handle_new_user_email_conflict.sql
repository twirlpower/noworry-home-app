-- ============================================================================
-- NoWorry Home — Migration 052: claim proxy persons row on signup
-- Run order: ..., 047_handle_new_user_phone.sql, ..., 051_visit_homeowner_feedback.sql,
--            then 052.
-- Depends on: persons (schema v1.0 — email is UNIQUE via constraint
--             persons_email_key; auth_status enum already includes 'claimed'),
--             handle_new_user() (last redefined in 047).
--
-- PROBLEM (signup-blocking bug)
-- When someone is invited to a circle WITH their email (Circle.jsx handleInvite
-- writes persons.email; Onboarding.jsx sendSingleInvite always does), a proxy
-- persons row is created: auth_id IS NULL, auth_status = 'proxy', email = <theirs>.
--
-- persons.email carries a UNIQUE constraint (persons_email_key — the
-- auto-generated name for the inline `email text unique` on
-- noworry_home_schema_v1.0.sql line 72). When that invitee later signs up at
-- /signup, the insert trigger handle_new_user() runs:
--
--     insert into persons (auth_id, email, ...) values (new.id, new.email, ...)
--     on conflict (auth_id) do nothing;
--
-- The new auth_id does not collide, but new.email DOES collide with the proxy
-- row. ON CONFLICT names the auth_id index only, so a unique violation on
-- persons_email_key is NOT swallowed — it raises, the trigger aborts, and the
-- enclosing auth.users insert rolls back. The invitee cannot create an account.
--
-- FIX
-- Before inserting, try to CLAIM an existing proxy row with this email:
--   • UPDATE persons SET auth_id = new.id, auth_status = 'claimed', and fill in
--     phone / names from the signup metadata, then RETURN — no INSERT runs, so
--     the email constraint is never touched.
--   • If no proxy row matches, fall through to the original INSERT unchanged.
-- Their existing circle_memberships rows (status = 'invited') are untouched and
-- can be activated afterward by a separate claim/accept step.
--
-- 'claimed' enum value: ALREADY EXISTS. The auth_status enum is defined as
--   ('active', 'proxy', 'claimed', 'deactivated')  -- schema v1.0 line 14
-- so NO `alter type ... add value` is needed. (Note: the enum TYPE is named
-- `auth_status`, not `auth_status_type`.)
--
-- DESIGN NOTES
--   • Match is exact (email = new.email). That is precisely the set of rows
--     that would trip persons_email_key, and it uses idx_persons_email. Supabase
--     normalizes auth emails to lower-case; if a proxy email was stored in a
--     different case there is no unique collision anyway, so the original INSERT
--     path is safe for that scenario.
--   • `and auth_id is null` ensures we only ever claim a proxy (never re-point
--     an already-active account). At most one row matches (email is UNIQUE).
--   • Names: overwritten when the existing value is null/blank OR is an
--     Onboarding email-only invite placeholder — and only when the signup
--     metadata actually carries a value (so we never blank out a name).
--       - last_name placeholder is the literal '(pending)'.
--       - first_name placeholder is email-derived: Onboarding.jsx
--         sendSingleInvite builds it as
--           local = split_part(email,'@',1) with /[._-]+/ collapsed to ' ',
--           placeholder = upper(local[0]) || local[1..].
--         There is no constant to match, so we recompute that exact transform
--         from new.email (v_placeholder_first) and compare. A real first name
--         typed by an inviter in Circle.jsx won't match the email-derived form,
--         so it is preserved. (Edge case: if an inviter-typed first name
--         happens to equal the email-derived form, the claimer's own metadata
--         name wins — acceptable.)
--   • Phone: prefer the claimer's signup phone, but coalesce back to any
--     existing value so a metadata-less signup path can't null out a phone the
--     proxy already had.
--   • ON CONFLICT (auth_id) DO NOTHING is kept on the INSERT branch as a
--     belt-and-suspenders guard for the (not-expected) case where a persons row
--     already exists for this auth_id.
--
-- Grants/revokes: CREATE OR REPLACE preserves existing permissions. Migration
-- 021 revoked EXECUTE from PUBLIC and anon on handle_new_user(); those revokes
-- remain in effect. The trigger on auth.users is unchanged (047 also replaced
-- the function only, not the trigger).
--
-- Idempotent: CREATE OR REPLACE on the function; re-runs are no-ops.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Recompute Onboarding.jsx sendSingleInvite's first_name placeholder so a
  -- claim can recognize and replace it. Mirrors the JS exactly:
  --   local = email.split('@')[0].replace(/[._-]+/g, ' ')
  --   placeholderFirst = local[0].toUpperCase() + local.slice(1)
  v_local             text := regexp_replace(split_part(new.email, '@', 1), '[._-]+', ' ', 'g');
  v_placeholder_first text := upper(left(v_local, 1)) || substr(v_local, 2);
  -- Trimmed, null-if-blank signup metadata values — gate every overwrite so we
  -- never replace a name/placeholder with an empty string.
  v_meta_first        text := nullif(btrim(coalesce(new.raw_user_meta_data->>'first_name', '')), '');
  v_meta_last         text := nullif(btrim(coalesce(new.raw_user_meta_data->>'last_name', '')), '');
begin
  -- ── Claim path: an invited proxy already holds this email. Promote that
  -- row in place instead of inserting (which would violate persons_email_key
  -- and roll back the auth signup).
  update public.persons
     set auth_id     = new.id,
         auth_status = 'claimed',
         phone       = coalesce(
                         nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
                         phone
                       ),
         -- Overwrite first_name when it is blank OR the email-derived invite
         -- placeholder, but only if the claimer actually supplied one.
         first_name  = case
                         when v_meta_first is not null
                          and (first_name is null or btrim(first_name) = '' or first_name = v_placeholder_first)
                           then v_meta_first
                         else first_name
                       end,
         -- Same rule for last_name; the Onboarding placeholder is '(pending)'.
         last_name   = case
                         when v_meta_last is not null
                          and (last_name is null or btrim(last_name) = '' or last_name = '(pending)')
                           then v_meta_last
                         else last_name
                       end
   where email = new.email
     and auth_id is null;

  if found then
    return new;
  end if;

  -- ── New-user path: no proxy to claim → original behavior, unchanged.
  insert into public.persons (auth_id, email, first_name, last_name, phone, auth_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    'active'
  )
  on conflict (auth_id) do nothing;

  return new;
end;
$$;
