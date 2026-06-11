-- ============================================================================
-- NoWorry Home — Migration 047: write phone from auth metadata into persons
-- Run order: ..., 046_path_a_circle_manager.sql, then 047.
--
-- persons.phone (text, nullable) was present since schema v1.0 but
-- handle_new_user() never wrote it. Signup.jsx now passes phone in
-- supabase.auth.signUp() user_metadata; this migration teaches the
-- trigger to persist it.
--
-- nullif(trim(...), '') converts an absent or blank phone value to NULL
-- so existing signups (no phone in metadata) don't write an empty string.
--
-- on conflict (auth_id) do nothing stays as-is — re-runs are no-ops.
--
-- Grants/revokes: CREATE OR REPLACE preserves existing permissions.
-- Migration 021 already revoked execute from PUBLIC and anon; those
-- revokes remain in effect after this replace. No re-grant needed.
--
-- Backfill: not possible for existing accounts (phone was never in
-- auth metadata, so there is nothing to read back). Existing persons
-- rows stay with phone = NULL and can be updated by the user via
-- Settings → My Profile.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
