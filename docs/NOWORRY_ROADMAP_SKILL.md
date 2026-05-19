---
name: noworry-roadmap
description: Use this skill whenever updating the NoWorry Home app roadmap or when completing features from the roadmap. Triggers include: user mentions "roadmap", "update the roadmap", "check off", "mark as done", finishing a feature listed on the roadmap, deploying code, running schema migrations, or any structural change to the NoWorry Home app. Also use when the user asks what's next, what's been completed, or wants to review project status for NoWorry Home. Also trigger when the user completes work on the marketing site, Supabase schema, Family Graph spec, or any NoWorry Home deliverable. Always read this skill before modifying the roadmap file to understand the format and location.
---

# NoWorry Home Roadmap Update Skill

## Roadmap File Location

The roadmap lives in TWO places that must stay in sync:

1. **In the repo**: `docs/App_Development_Roadmap.md` (in the noworry-home-app repo)
2. **In the Claude project**: uploaded as a project knowledge file

When updating the roadmap, always update the repo copy and push it. The project knowledge copy will be updated manually by the user.

If the repo isn't available in this session, create the updated roadmap as a downloadable file for the user to commit manually.

## When to Update

Update the roadmap whenever you:
- Complete a feature that's listed as ⬜ → change to ✅
- Add a new feature or section
- Restructure the app architecture
- Add new roadmap items from discussion with the user
- Deploy code to Vercel or run migrations in Supabase
- Complete any NoWorry Home deliverable (spec document, website page, schema, etc.)
- Change the active sprint focus

## Format Rules

- Use `✅` for completed items
- Use `⬜` for incomplete items
- Update the date on line 3: `Updated: [Month Day, Year]`
- Keep sections in order: Vision → Architecture Decisions → What's Built → Active Sprint → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Open Questions
- When moving items between sections (e.g., from Active Sprint to What's Built), update both sections
- Architecture decisions go in the Architecture Decisions section
- New open questions go in the Open Questions section

## After Every Session Where Work Was Done

At the end of every session where NoWorry Home work was completed:

1. Read the current roadmap
2. Check off any items that were completed in this session
3. Add any new items that were discussed or discovered
4. Add any new architecture decisions
5. Update the date
6. Save/commit the updated roadmap

## Key Architecture References

These documents define the platform architecture. Read them before making structural changes:

- **Family Graph Spec v1.0**: Entity model, roles, permissions, control transfer, onboarding
- **Platform Roadmap v1.1**: Business strategy, tier model, geo-gating, vendor network
- **Brand Guidelines v1.0**: Colors, typography, voice, accessibility standards
- **SQL Schema v1.0**: 19 tables, all enums, RLS enabled

## Database Migrations

All SQL migrations (schema, RLS policies, functions, triggers, seed data) live
in a top-level `migrations/` folder in the repo — **not** in `docs/`. Name them
in run order, e.g. `001_schema.sql`, `002_rls_v1.sql`, `003_rls_v2.sql`.

`docs/` is for documentation only (specs, roadmap, this skill).

When you write a new migration:
- Create it under `migrations/`
- Make it idempotent where practical (drop-if-exists before create)
- Note in the roadmap that it is written vs. deployed (the user runs SQL in
  the Supabase SQL Editor; deployment is not automatic)

The original three migrations were relocated from `docs/` to `migrations/`
(`noworry_home_schema_v1.0.sql`, `rls_policies_v1.sql`, `rls_policies_v2.sql`),
so `migrations/` is the single canonical home for all SQL — no exceptions.

## Current Stack

- **Database**: Supabase (new project, separate from HomeKeep/TwirlPower)
- **Hosting**: Vercel (noworry-home-app project)
- **Code**: GitHub (twirlpower/noworry-home-app)
- **Domain**: noworry-home.com (app.noworry-home.com for the app)

## Customer-Facing Role Names

Always use these names in UI code, not the technical names:

| Internal | Customer-facing |
|----------|----------------|
| Family Circle | Home Circle |
| Homeowner | Home Owner |
| Circle Admin | Circle Manager |
| Family Care Partner | Care Partner |
| Professional Care Partner | Service Partner |
| Family Helper | Helper |
| Family Viewer | Family Member |
| Trusted Advisor | Trusted Advisor |
