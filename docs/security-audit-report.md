# NoWorry Home Security Audit

**Date:** 2026-06-10
**Auditor:** Claude Code
**Scope:** 11 TwirlPower security standards applied to noworry-home-app
**Supabase project:** hyqurxvuxhwjeqxchuuz

> **Method note / important caveat:** The Supabase MCP connection in this session is **permission-denied for every call** (`execute_sql`, `list_tables`, `list_migrations` all return `-32600 You do not have permission`). I could **not** query the live database. Every finding below is derived from **migration source** in `migrations/` (52 numbered files + `noworry_home_schema_v1.0.sql`, `rls_policies_v1.sql`, `rls_policies_v2.sql`) and the `src/` tree. Items that can only be confirmed against live catalog state (`pg_class.relrowsecurity`, `pg_policies`) are marked **🔍 Cannot determine from source** and **must be re-run by Tye in the Supabase SQL editor** before acting. Migrations live in `migrations/` — there is **no** `supabase/migrations/` folder.

---

## Summary Table

| # | Item | Status | Priority |
|---|------|--------|----------|
| 1 | RLS on Every Table | ✅ (confirmed live — all 36 tables `relrowsecurity=true`) | High |
| 2 | SECURITY DEFINER RPCs for Sensitive Ops | ✅ | High |
| 3 | `.maybeSingle()` vs `.single()` | ✅ (Phase 2 — all 17 `.single()` calls replaced) | High |
| 4 | Supabase Join Syntax (RLS bypass risk) | ⚠️ (many embedded joins; low real risk — not changed) | High |
| 5 | Admin Gate Using `auth.jwt() ->> 'email'` | ✅ | Medium |
| 6 | View-Only Role Write Gating | ✅ (Phase 2 — in-function guards added to 8 pages) | High |
| 7 | Admin Role Elevation RPC Pattern | ✅ | Medium |
| 8 | No Direct `auth.users` Queries from Client | ✅ | Medium |
| 9 | PostgREST Metacharacter Escaping | ✅ | Low |
| 10 | Signed Tokens / Open Read Policies | ⚠️ (`home_seeds` has `USING (true)` open read — intentional lookup table; flagged) | Medium |
| 11 | Duplicate RLS Policies | ✅ (Migration 053 drops the `emergency_contacts` legacy policy; rest intentional) | Medium |

---

## Detailed Findings

### Item 1 — RLS on Every Table
**Status:** ✅ Pass (confirmed against live DB in Phase 2)
**Update (Phase 2 — Query A & C results pasted by Tye):** Every one of the 36 public tables reports `relrowsecurity = true`, **including `maintenance_templates` and `home_seeds`**. The Phase-1 concern was that the *migration source* lacked an explicit `ENABLE ROW LEVEL SECURITY` for `maintenance_templates`; the live database has it enabled regardless (applied out-of-band or via a path not in the tracked migration files). **No Fix 1 migration was written** — none is needed.

**Original Phase-1 finding (now resolved):** `maintenance_templates` (created `noworry_home_schema_v1.0.sql:500`) was absent from the v1.0 enable block (lines 573–591) and no tracked migration re-enabled it, even though policies are attached (`004:14-16`, `026`/`027`). Live state shows RLS is on, so the attached policies are active.

**Tables created and confirmed `enable row level security` in source:**
persons, homes, home_systems, family_circles, circle_memberships, circle_homes, maintenance_events, documents, tasks, succession_configs, family_groups, family_group_circles, home_transfers, notifications, notification_preferences, notes, emergency_contacts, audit_log, scheduled_maintenance (schema v1.0); safety_checklist (005); crm_contacts, crm_partners, vendors (017); staff_accounts (018); vendor_jobs (024); zip_refresh_status (028); promo_redemptions (032); hometech_accounts (034); home_systems + home_hazards (035); home_visits, visit_checklist_items (036); advisor_grants, advisor_access_log (040); leads (042); circle_welcome_messages (043); circle_vendors (045).

**Tables without an `enable RLS` statement in source:**
- **`maintenance_templates`** — has policies but no `ENABLE ROW LEVEL SECURITY` found. Low data-sensitivity (global system reference data, no PII), but write-exposure is possible if a table-level INSERT/UPDATE grant exists and RLS is off.
- **`home_seeds`** — referenced in `028`, `Onboarding.jsx:124`, and `scripts/`, but **its `CREATE TABLE` / RLS is not in this migrations folder** (created out-of-band). Cannot assess from source. The smoke test reads it as an authenticated user, so *some* read access exists. (See Item 10 — flagged, not auto-fixed.)

**Recommended Fix:** In the SQL editor, run the Item 1 catalog query plus `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('maintenance_templates','home_seeds');`. If `maintenance_templates.relrowsecurity = false`, add a one-line migration: `ALTER TABLE public.maintenance_templates ENABLE ROW LEVEL SECURITY;` (its read + staff-write policies already exist). Confirm `home_seeds` posture separately.

---

### Item 2 — SECURITY DEFINER RPCs for Sensitive Operations
**Status:** ✅ Pass
**Finding:** The sensitive RPCs all use `SECURITY DEFINER`, set `search_path`, enforce caller authorization internally, and follow the `REVOKE … FROM PUBLIC` + `GRANT … TO authenticated` lockdown (hardened in migration `021_security_linter_fixes.sql`).

| Function | Touches | SECURITY DEFINER | REVOKE PUBLIC/anon | GRANT |
|---|---|---|---|---|
| `add_staff_account` (018) | `auth.users`, `staff_accounts` | ✅ (+`search_path=public`) | ✅ `revoke all from public` | `authenticated` |
| `setup_home_circle` (021) | homes, circles, `circle_memberships` | ✅ | ✅ `from public` | `authenticated` |
| `handle_new_user` (021/047/052) | persons / signup | ✅ | ✅ `from anon` + `from public` | trigger |
| `update_updated_at` (021) | trigger util | ✅ (`search_path` set) | n/a | n/a |
| `generate_maintenance_for_home` (004/015) | tasks/templates | ✅ | — | `authenticated` |
| `is_active_staff` / `is_active_hometech` / `can_view_person` / `has_pillar2_access` (027/034/039) | policy helpers | ✅ | — | helper |
| `admin_member_zip_counts` (029), `admin_list_members` (033), `get_home_visits` (036) | PII joins, guarded by `is_active_staff()` / auth check | ✅ | — | `authenticated` |

**Note (not a failure):** The TwirlPower checklist item literally asks for `GRANT … TO service_role`. These are **client-callable RPCs**, so granting to `authenticated` (with an internal `auth.uid()`/role guard) is the correct pattern — a service_role-only grant would make them uncallable from the SPA. Posture is sound.
**Recommended Fix:** None. Optionally re-run the live `pg_proc` query to confirm no out-of-band function was added after migration 052 without the REVOKE/GRANT pattern.

---

### Item 3 — `.maybeSingle()` vs `.single()`
**Status:** ✅ Fixed in Phase 2 (was ❌)
**Phase 2 result:** All **17** `.single()` calls replaced with `.maybeSingle()` plus context-appropriate null handling. `grep "\.single()" src/` now returns **zero** matches. `npm run lint` adds no new errors; `npm run build` passes. See Fix Log.

**Original Phase-1 finding:** `grep` found **17** `.single()` calls in `src/` and **zero** `.maybeSingle()`. Most are `insert(...).select().single()` (lower crash risk — the row was just inserted, though an RLS-blocked return still throws); a few are lookups where a missing row will throw `PGRST116` and crash the handler.

| File | Line | Shape |
|---|---|---|
| `src/components/admin/CRMLeadsTab.jsx` | 181 | insert→single |
| `src/components/admin/CRMMaintenanceTab.jsx` | 162, 169 | insert/update→single |
| `src/components/admin/CRMPartnersTab.jsx` | 156 | insert→single |
| `src/components/admin/CRMProspectsTab.jsx` | 125 | insert→single |
| `src/components/admin/CRMVendorsTab.jsx` | 153 | insert→single |
| `src/components/admin/VendorJobsSection.jsx` | 151, 192 | insert/update→single |
| `src/pages/Circle.jsx` | 113 | insert→single |
| `src/pages/EmergencyContacts.jsx` | 144 | insert→single |
| `src/pages/HomeProfile.jsx` | 157 | insert/update→single |
| `src/pages/Onboarding.jsx` | 461 | insert→single |
| `src/pages/Settings.jsx` | 291 | update→single |
| `src/pages/Tasks.jsx` | 311 | insert→single |
| `src/pages/Vendors.jsx` | 158 | insert→single |
| `src/lib/documents.js` | 60 | insert→single |
| `src/lib/techSync.js` | 301 | select→single (lookup) |

**Recommended Fix:** Replace each with `.maybeSingle()` and add a context-appropriate null check (return + surface the error; do not silently swallow). The pure-lookup calls (`techSync.js:301`) are the highest priority; insert-return calls are lower but should still be converted for consistency, since an RLS denial on the `RETURNING` row currently throws rather than surfacing a clean message.

---

### Item 4 — Supabase Join Syntax (RLS Bypass Risk)
**Status:** ⚠️ Partial (flagged per standard; real-world risk is **low**)
**Finding:** Many `.select()` calls use PostgREST **embedded-resource** syntax that crosses tables, e.g.:
- `circle_homes → homes(*)`: `homeowner/Dashboard.jsx:101`, `family/Dashboard.jsx:52`, `admin/Dashboard.jsx:215`, `HomeProfile.jsx:79`
- `circle_memberships → persons!person_id(...)`: `Circle.jsx:51,86`, `Tasks.jsx:134,139,179,310`, `homeowner/Dashboard.jsx:131,137`, `CircleContext.jsx:31 (family_circles(*)),49`, `WelcomeMessage.jsx:32`
- tech pages: `TechHomes.jsx:116`, `TechChecklist.jsx:63,78`, `TechAssessment.jsx:112`

**Technical reality:** Contrary to the standard's framing, PostgREST **does enforce RLS on embedded resources** — a join does not bypass RLS as long as the joined table (`homes`, `persons`, `family_circles`) has RLS enabled, which they all do (Item 1). The embed simply returns `null`/filtered rows when the child policy denies, and the code already null-guards (e.g. `CircleContext.jsx:54`). So these are **not** a live RLS bypass.
**Recommended Fix:** No mass refactor required for security. Treat the two-query split as optional defense-in-depth / style. **Exception:** if the Item 1 check shows any *joined* table with RLS disabled, the embed against that specific table would over-expose — prioritize splitting only those.

**Phase 2 update:** Item 1's live check confirmed **all 36 tables (every joined table — `homes`, `persons`, `family_circles`, `circle_homes`) have RLS enabled**, so the exception above does not trigger and there is no live over-exposure. Per Tye's Phase-2 instructions ("Fix 3 — refactor join syntax" was **not** in the approved fix set), no joins were changed. Left as-is intentionally; revisit only if a future table ships with RLS off.

---

### Item 5 — Admin Gate Using `auth.jwt() ->> 'email'`
**Status:** ✅ Pass
**Finding:** The only email-based gate (`auth.jwt() ->> 'email' = 'tye@oakraa.com'` in `017_admin_crm_tables.sql:41-94`) uses the **non-spoofable JWT claim form** (✅ pattern, not a `persons.email`/`auth.users.email` column comparison). It was furthermore **superseded** in `025_admin_crm_rls_realign.sql`, which drops the `"Founder full access …"` policies and replaces them with `staff_accounts`-based checks keyed on `auth.uid()` — eliminating the hardcoded-email gate entirely.
**Recommended Fix:** None. (Optional cleanup: nothing references the old founder policies anymore; 025's `DROP POLICY IF EXISTS` already removes them.)

---

### Item 6 — View-Only Role Write Gating
**Status:** ✅ Fixed in Phase 2 (was ⚠️)
**Phase 2 result:** In-function write guards added to **all member-facing write handlers across 8 pages**, using the existing **allowlist** convention (`!canManage` / `!canEdit` / `!canGenerate`) rather than a literal `=== 'view_only'` denylist. **Decision (Tye approved via prompt):** the allowlist is strictly stronger — it blocks `view_only` *and* the other non-editor roles (`trusted_advisor`, `service_partner`, `helper`, `emergency_contact`, `professional_advisor`) — and matches what every page already computes and what `Safety.jsx` already enforced; a literal `view_only` check would have *weakened* `Safety.jsx`. Each guard logs `console.warn` and returns before the Supabase call. View-only informational banners (`page-placeholder` class, matching `Safety.jsx`) added to the 6 home-data pages a `view_only` user can browse. Full per-function list in the Fix Log.

Two special cases handled to avoid regressions:
- **`Tasks.postNote`** is guarded with `hasPillar2Access(membership?.role)` (not `!canManage`) because `notes` INSERT is allowed for `family_member` (migration 031), who is *not* in `MANAGE_ROLES` — `!canManage` would have wrongly blocked them. `hasPillar2Access` maps exactly to the family-write set and excludes `view_only`.
- **`Tasks.markComplete` / `reopenTask`** are guarded with `canActOn(t)` (assignee OR manager), preserving the RLS rule that a task's assignee can update their own task regardless of role.
- **`Settings.savePrefs`** was deliberately **left unguarded** — a `view_only` user may edit their *own* notification preferences (RLS scopes to `person_id = current_person_id()`); only `saveCircleName` got the `!canRename` guard. No banner on Settings (would be misleading).

**Original Phase-1 finding:** `CircleContext.jsx` does **not** expose a field named `userRole`. It exposes `membership` (and `membership.role`, sourced correctly from `circle_memberships.role` via the query at `CircleContext.jsx:27-34`). Pages derive booleans like `canManage = MANAGE_ROLES.includes(membership?.role)` and **use them to hide UI**, but the **write functions themselves do not hard-block** on role. Verified by reading the actual handlers:
- `EmergencyContacts.jsx handleSave` (120-170): no role guard — relies on UI hide + DB RLS.
- `Tasks.jsx handleSave` (209-245): no role guard — same.
- **Only** `Safety.jsx toggle` (68: `if (!canEdit || !homeId) return`) has an in-function guard.

The effective protection for `view_only` writes is therefore **(a) the Add/Edit buttons are not rendered, and (b) RLS denies the write at the DB** (`view_only` is in `PILLAR2_BLOCKED_ROLES` in `lib/permissions.js:22-26`, and migration `039_pillar2_role_lockdown` + `016_view_only_rls_read_parity` grant read-only, not write). RLS is the real backstop and it appears correct — but per the TwirlPower standard, a UI hide is not a substitute for an in-function guard.
**Recommended Fix:** Add a hard guard at the top of every write handler. Because the codebase uses `membership.role` (not `userRole`), the guard should read:
```jsx
if (!canManage) { console.warn('Write blocked: insufficient role'); return }
```
…or block `view_only` explicitly. Verify each page's write handler (`Tasks`, `EmergencyContacts`, `HomeProfile`, `Documents`, `Vendors`, `Settings`, `Circle`, `Maintenance`). **Do not** introduce a new `userRole` field — match the existing `membership.role` / `canManage` convention. Optionally surface a non-alarming "view-only access" line (Safety.jsx:161 already models this).

---

### Item 7 — Admin Role Elevation RPC Pattern
**Status:** ✅ Pass
**Finding:** `add_staff_account` (`018:89-131`) verifies the caller server-side (`exists(… staff_accounts where user_id = auth.uid() and role='owner' and active`), **prevents privilege escalation** by rejecting any `p_role not in ('staff','readonly')` — so the `owner` role can never be granted through this path — is `SECURITY DEFINER` with `set search_path = public`, and is locked down via `revoke all … from public` + `grant execute … to authenticated`. The `staff_accounts` policies themselves (018:39-62) use the self-row-read + owner-check recursion-safe pattern.
**Recommended Fix:** None required. Minor hardening option (not blocking): add an explicit self-revocation guard so an owner can't deactivate their own last owner row, and consider preventing an owner from editing their own `role` row. Low priority.

---

### Item 8 — No Direct `auth.users` Queries from Client
**Status:** ✅ Pass
**Finding:** No client-side query targets `auth.users`. The only `grep` hit is a **comment** in `StaffAccountsCard.jsx:77` documenting that the server-side RPC performs the lookup. The actual `auth.users` email→id lookup is done inside the `add_staff_account` SECURITY DEFINER RPC (`018:117`).
**Recommended Fix:** None.

---

### Item 9 — PostgREST Metacharacter Escaping
**Status:** ✅ Pass
**Finding:** There are **zero** `.ilike()` / `.like()` calls in `src/`. The single full-text call is `Onboarding.jsx:128` `.textSearch('address_line1', terms.join(' & '))`, and its input is **already sanitized**: `Onboarding.jsx:119` strips every non-word character (`.replace(/[^\w]/g, '')`), removing `%`, `_`, and tsquery metacharacters (`&`, `|`, `!`, `:`, `*`, parentheses) before the controlled `:*` prefix and ` & ` join are appended.
**Recommended Fix:** None. (If `.ilike()` is introduced later, add the `escapeIlike` helper described in the task's Fix 5.)

---

### Item 10 — Signed Tokens for Share Links / External Access
**Status:** ⚠️ Pass-with-flag (one intentional open-read on a lookup table)
**Phase 2 update (Query B reviewed):** Exactly **one** policy in the live DB uses `USING (true)`:
- `home_seeds` → `"Anyone can read home seeds"` (SELECT, `qual = true`).

This is the public county-assessor address-autocomplete lookup table (Arapahoe/Douglas), consumed by `Onboarding.jsx:124`. Per the task instructions, `home_seeds` open read is **flagged but not auto-fixed** — it is a lookup table by design. No other table has an open policy; no "share with family / external vendor" flow uses one (invitations go through `circle_memberships` rows, not public links). There is no signed-token share flow in the codebase to audit.
**Recommended Fix:** Confirm `home_seeds` exposes only public assessor fields (address, year built, sqft, etc.) and **no PII** — the `SELECT` list at `Onboarding.jsx:125-127` reads only such fields, which is consistent with intended use. If any sensitive column ever lands on that table, replace the open policy with an `authenticated`-scoped one. No change made this phase.

**Original Phase-1 finding:** `grep` over `migrations/` found no `USING (true)` because `home_seeds`' DDL/policy is **out-of-band** (not in the tracked migration files); the live `pg_policies` result surfaced it.

---

### Item 11 — Duplicate RLS Policies
**Status:** ✅ Resolved — migration `053` drops the one `emergency_contacts` anomaly; all other multi-policy tables are intentional.
**Resolution:** Tye confirmed the granular `emergency_contacts_insert` `with_check` already admits `circle_manager`, so the legacy `circle_manager_write_emergency_contacts` (`ALL`, circle_manager-only) is a strict subset of the four granular policies (which cover `home_owner`, `circle_manager`, `care_partner`, `care_coordinator` on every operation). `migrations/053_drop_legacy_emergency_contacts_policy.sql` drops it — no functional change, removes silent OR-stacking. **Executed in Supabase (2026-06-10).**
**Phase 2 analysis of Query B.** Every public table's policies were grouped by `(cmd, roles)` (all policies are `roles = {public}`, scoped inside `qual`). Tables with 2+ same-`cmd` policies, classified:

**Intentional additive (OR-by-design — leave as-is):**
- `advisor_grants` — 2× SELECT: `advisor_grants_self_select` (advisor sees own) **OR** `advisor_grants_admin_select` (managers see all). Different actor classes; correct.
- `home_visits` — 2× SELECT (`Staff read all` / `Circle members read own`) and 2× UPDATE (`HomeTech update` / `Homeowner feedback update`). Distinct actors; correct.
- `hometech_accounts` — 2× SELECT (`Staff read all` / `HomeTech read own row`). Correct.
- `visit_checklist_items` — 2× SELECT (`Staff read all` / `Circle members read own`). Correct.
- `staff_accounts` — `Owner full access` (ALL) **+** `Staff can read own row` (SELECT). This is the **documented recursion-safe self-read pattern** (migration `018:34-42`). Correct — do **not** drop.

**Anomaly requiring manual confirmation (do NOT auto-drop):**
- **`emergency_contacts`** has a legacy `ALL`-command policy `circle_manager_write_emergency_contacts` (raw-subquery style, `circle_manager` only) **overlapping** the modern helper-based granular policies (`emergency_contacts_select` / `_insert` / `_update` / `_delete`). The granular SELECT/UPDATE/DELETE policies already include `circle_manager` (via `has_pillar2_access` / explicit role arrays), so the `ALL` policy is **likely a superseded orphan** — but Query B only returns `qual`, **not `with_check`**, so I cannot confirm the granular **INSERT** policy already covers `circle_manager`. If it doesn't, dropping the `ALL` policy would silently remove `circle_manager`'s INSERT ability. Per Fix 4 ("Do not drop a policy if you are not certain… flag it as a manual review item"), **no drop migration was written.**

**Recommended Fix (manual, before any drop):** Run
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='emergency_contacts'
ORDER BY cmd, policyname;
```
If the `emergency_contacts_insert` `with_check` already admits `circle_manager` (it almost certainly does — it mirrors the other granular policies), then `circle_manager_write_emergency_contacts` is redundant and can be dropped with a migration:
```sql
-- Audit confirmed: emergency_contacts has a legacy ALL-command policy that
-- overlaps the granular per-command policies; circle_manager is already
-- covered by emergency_contacts_{select,insert,update,delete}.
DROP POLICY IF EXISTS "circle_manager_write_emergency_contacts" ON public.emergency_contacts;
```
Paste the `with_check` result back and I'll write the numbered migration (next number **053**).

---

## Fix Queue

Ordered by priority. Items **1, 2, 3, 4, and 6** are called out as highest priority before beta launch; of these, 2 already passes.

| Priority | Item | Fix Type | Estimated Scope |
|----------|------|----------|-----------------|
| P0 | 6 | View-only **hard guard** in each write handler (`if (!canManage) return`) | ✅ Done — 8 pages |
| P0 | 1 | Verify `maintenance_templates.relrowsecurity` live; enable if off | ✅ Verified live = on; no migration needed |
| P0 | 3 | `.single()` → `.maybeSingle()` + null checks | ✅ Done — 17 call sites |
| P1 | 11 | Review `pg_policies`; drop any duplicate via migration | ✅ Migration 053 executed (dropped `emergency_contacts` legacy policy) |
| P1 | 10 | Confirm `home_seeds` read policy is ≤ authenticated & PII-free | ⚠️ Open read confirmed (intentional lookup); PII review recommended |
| P2 | 4 | Split embedded joins against any RLS-disabled child table | ✅ N/A — all joined tables have RLS on; not in approved fix set |
| — | 2, 5, 7, 8, 9 | No action (Pass) | — |

---

## Phase 2 — Implementation Log

**Date:** 2026-06-10  ·  **Verification:** `npm run lint` (no new errors — only the 5 pre-existing scaffold `react-refresh`/`set-state-in-effect` baseline issues in `AuthContext`/`CircleContext`/`StaffModeContext`/`ViewContext`, none in edited files) · `npm run build` ✅ passes.

**SQL results provided by Tye** (Queries A, B, C) resolved all four Phase-1 blocking ambiguities: all 36 tables have RLS on (Item 1 ✅, no migration needed); `home_seeds` has an intentional `USING (true)` open read (Item 10 ⚠️ flagged); the duplicate-policy scan found one `emergency_contacts` anomaly (Item 11 ⚠️, flagged not dropped). Guard style confirmed by Tye = **allowlist `!canManage`** (Item 6).

### Fix Log

| Migration | Description | Status |
|-----------|-------------|--------|
| — (053 reserved) | Enable RLS on `maintenance_templates` | ❌ Not needed — live `relrowsecurity = true` |
| — (code) | `.single()` → `.maybeSingle()` + null handling (17 calls, 15 files) | ✅ Complete |
| — (code) | `view_only` write guards via `!canManage` allowlist (8 pages) + view-only banners (6 pages) | ✅ Complete |
| `053` | Drop superseded `circle_manager_write_emergency_contacts` (`emergency_contacts`) | ✅ Written **and executed** in Supabase (2026-06-10) |

**Migration `053`** (`migrations/053_drop_legacy_emergency_contacts_policy.sql`) drops the one confirmed-redundant legacy policy — **executed by Tye in the Supabase SQL editor**. No functional access change; `emergency_contacts` now has only the four granular per-command policies. Note: written to `migrations/` (this repo's actual migration folder — there is no `supabase/migrations/`), keeping it in sequence after `052`.

#### Fix 2 — `.single()` → `.maybeSingle()` (17 calls across 15 files)
Each null case handled in context (early return + surfaced message; never silently swallowed):

| File | Handler | Null handling |
|---|---|---|
| `pages/Circle.jsx` | `handleInvite` | early return, `setError` |
| `pages/EmergencyContacts.jsx` | `handleSave` | early return, `setError` |
| `pages/HomeProfile.jsx` | `handleSave` (homes) | early return, `setError` |
| `pages/Tasks.jsx` | `postNote` | early return, `setNoteError` |
| `pages/Vendors.jsx` | `handleSave` | early return, `setError` |
| `pages/Settings.jsx` | `saveCircleName` | early return, `setCError` (guards the `data.name` deref) |
| `pages/Onboarding.jsx` | invite person insert | early return, `setError` |
| `lib/documents.js` | `uploadDocument` | cleanup uploaded object + `throw` |
| `lib/techSync.js` | `syncOneChecklist` | pre-existing `if (vErr || !visitRow) throw` retained |
| `components/admin/CRMLeadsTab.jsx` | convert (`ins`) | early return (guards `ins.data.id` deref) |
| `components/admin/CRMMaintenanceTab.jsx` | save (insert + update) | `res.data` unused downstream — convert only |
| `components/admin/CRMPartnersTab.jsx` | save | pre-existing `if (!res.error && res.data)` guard retained |
| `components/admin/CRMProspectsTab.jsx` | save | pre-existing guard retained |
| `components/admin/CRMVendorsTab.jsx` | save | pre-existing guard retained |
| `components/admin/VendorJobsSection.jsx` | `handleLogJob` + `handleMarkPaid` | early return on each (guards `data` deref at the list map) |

#### Fix 3 — view-only write guards (allowlist `!canManage`)
In-function guards added before the Supabase write in every member-facing write handler:

| Page | Guarded handlers | Predicate | Banner |
|---|---|---|---|
| `Tasks.jsx` | `handleSave`, `removeTask` (`!canManage`); `markComplete`, `reopenTask` (`!canActOn`); `postNote` (`!hasPillar2Access`) | mixed (see Item 6) | ✅ |
| `Circle.jsx` | `handleInvite` (`!canManage`); `updateHomeownerGender` (`!PRONOUN_EDIT_ROLES`); `toggleGrant` (`!canManage` prop) | mixed | ✅ |
| `HomeProfile.jsx` | `handleSave`, `handleSaveSystem`, `handleRemoveSystem` (`!canEdit`) | `canEdit` | ✅ |
| `EmergencyContacts.jsx` | `handleSave`, `handleDelete` (`!canManage`) | `canManage` | — (view_only can't read EC: `has_pillar2_access` excludes it) |
| `Documents.jsx` | `handleUpload`, `archiveDoc` (`!canManage`) | `canManage` | ✅ |
| `Vendors.jsx` | `handleSave`, `handleSoftDelete` (`!canManage`) | `canManage` | ✅ |
| `Maintenance.jsx` | `handleRefresh` (`!canGenerate`) | `canGenerate` | ✅ |
| `Settings.jsx` | `saveCircleName` (`!canRename`) only — `savePrefs` intentionally unguarded | `canRename` | — (personal prefs editable) |
| `Safety.jsx` | already compliant (`if (!canEdit) return` + existing notice) | `canEdit` | already present |

Banners use the existing `page-placeholder` class (matching `Safety.jsx`), **not** inline `var(--color-*)` styles — those CSS variables are a different project's convention and are not defined in this app.

### Still open (manual, for Tye)
1. **Item 11 / `emergency_contacts`** — ✅ done. `migrations/053_drop_legacy_emergency_contacts_policy.sql` executed in Supabase (2026-06-10).
2. **Item 10 / `home_seeds`** — confirm the table holds only public assessor fields (no PII). Open read is intentional; no change unless a sensitive column exists.
3. **Item 2 (optional)** — re-run the `pg_proc` query to confirm no out-of-band function appeared after migration 052 without the REVOKE/GRANT pattern.

**Stopping here per Phase 1 instructions — no migrations or code changes written. Awaiting your review.**
