# NoWorry Home — App Development Roadmap

Updated: May 19, 2026

---

## Vision

A generational aging-in-place platform built on the Family Graph architecture. The family — not the individual — is the customer. Start with a free Home Base tier that works anywhere, expand to full-service coordination in active markets.

---

## Architecture Decisions

- **Three independent entities**: Person, Home, Family Circle (see Family Graph Spec v1.0)
- **Seven roles**: Home Owner, Circle Manager, Care Partner, Service Partner, Helper, Family Member, Trusted Advisor
- **Proxy accounts**: Home Owners who never log in — managed by Circle Manager
- **Circle isolation**: absolute privacy between circles, no data bridge
- **Permanent home record**: Carfax-for-homes — persists across ownership
- **Stack**: Supabase (PostgreSQL + Auth + Storage) → Vercel (hosting) → GitHub (code)
- **Schema**: 20 tables (incl. family_group_circles join table), RLS enabled, all enums use customer-facing names
- **RLS bootstrap pattern**: onboarding runs through a `SECURITY DEFINER` RPC (`setup_home_circle`) for atomicity and to bypass the RLS chicken-and-egg; the `persons` row is created by an `auth.users` trigger (`handle_new_user`) from signup metadata, not a client insert

---

## What's Built

### Infrastructure
- ✅ Supabase project created
- ✅ GitHub repo created (twirlpower/noworry-home-app)
- ✅ Vercel project created
- ✅ Family Graph Spec v1.0 complete
- ✅ SQL schema v1.0 written (19 tables)
- ✅ SQL schema deployed to Supabase (20 tables — roadmap's "19" undercounts the join table)
- ⬜ Supabase Auth configured
- ⬜ Supabase env vars added to Vercel
- ⬜ Storage buckets created (documents, avatars, proof-of-ownership)
- ⬜ RLS policies written and deployed (v1 + v2 deployed & smoke-tested — 7 tables: 5 bootstrap + home_systems + scheduled_maintenance — `migrations/rls_policies_v1.sql`, `migrations/rls_policies_v2.sql`; 13 tables still deny-all)

### Marketing Site
- ✅ Homepage built (index.html)
- ✅ Denver/Aurora location page built (locations-denver.html)
- ⬜ Marketing site deployed to Vercel
- ⬜ Privacy policy page
- ⬜ Terms of service page
- ⬜ Contact form
- ⬜ About page

---

## Active Sprint: App Shell + Onboarding

### App Shell
- ⬜ Project scaffolding (HTML/CSS/JS or framework decision)
- ⬜ App layout: nav, sidebar/circle switcher, main content area
- ⬜ Supabase client initialization
- ⬜ Auth: signup, login, logout, password reset
- ⬜ Auth: email verification flow
- ⬜ Protected route logic (redirect to login if not authenticated)
- ⬜ Circle switcher UI (for multi-circle users)

### Onboarding Flow
- ⬜ First screen: "Setting up for myself" vs "Setting up for someone else"
- ✅ Path A: Self-setup → create account → create home profile → auto-create circle (smoke-tested end-to-end)
- ⬜ Path B: Setting up for someone else → create account → create proxy Home Owner → create home profile → auto-create circle
- ⬜ Home profile form: address, year built, square footage, systems
- ⬜ Invite family members flow (optional, skippable)
- ⬜ Designate successor prompt (optional, skippable)

---

## Phase 1: Home Base (Free Tier)

### Pillar 1 — The Home
- ✅ Home profile view and edit
- ✅ Home systems list (add, edit, remove systems) — add/edit/remove live & smoke-tested (remove = soft-delete via is_active, covered by RLS v2 update)
- ⬜ Maintenance calendar (auto-generated from system data + templates) — view + RLS live; generation RPC + seeded CO templates written (migrations/004, explicit-RPC strategy), deploy pending
- ⬜ Safety checklist (grab bars, smoke detectors, trip hazards, etc.) — page + 13-item checklist with completion % built; migrations/005 (table + Pillar-1 RLS) deploy pending
- ✅ Home health score (simple traffic-light dashboard) — scoring lib + traffic-light widget with factor breakdown, wired into the dashboard
- ⬜ Seasonal maintenance reminders (Colorado-specific templates)
- ⬜ Asset warranty tracking — link warranty documents to home systems, track expiration dates, alert before lapse
- ⬜ Warranty document upload — tied to home systems, stored in Supabase storage

### Core Platform
- ⬜ Dashboard: home health score + upcoming maintenance + recent activity — health score + upcoming maintenance + open tasks wired to real data; recent activity placeholder (audit_log RLS not yet deployed)
- ⬜ Settings: profile, notification preferences, circle management
- ⬜ Mobile responsive (senior-first: large text, high contrast, simple nav) — pass done: nav scroll-row with 48px targets, stacked page/card headers + system/maint rows, 44px inline actions, 480px breakpoint; on-device verification still TODO
- ⬜ Accessibility audit (WCAG 2.1 AA minimum)

---

## Phase 2: Organized Tier (Paid Digital)

### Pillar 2 — The Plan
- ⬜ Document vault (upload, organize, tag by type)
- ⬜ Document checklist (will, POA, insurance, deed — shows gaps)
- ⬜ Emergency contacts list (ordered by priority)
- ⬜ Financial access planning (who has access to what)
- ⬜ Wishes and preferences

### Pillar 3 — The Family
- ⬜ Family member invitation flow (email + role assignment) — STARTED: My Circle page with member roster + invite form that creates an invited person + circle_membership (status=invited) under deployed v1 RLS; email delivery + account-claim-on-signup still TODO
- ⬜ Role management (Circle Manager can change roles)
- ⬜ Task management (create, assign, complete, comment)
- ⬜ Notes and family updates feed
- ⬜ Permission visibility ("you can see X, you cannot see Y")
- ⬜ Family dashboard (who's active, what's pending)
- ⬜ Prompt engine v1 (home-triggered: system age alerts)

### Billing
- ⬜ Stripe integration
- ⬜ Subscription management (upgrade, downgrade, cancel)
- ⬜ Family Group billing (multi-circle discounts)

---

## Phase 3: Peace of Mind + Total Care (Paid Local)

### Vendor Dispatch
- ⬜ Vendor directory (internal, admin-managed)
- ⬜ Service request flow (member requests → admin reviews → vendor dispatched)
- ⬜ Service tracking (scheduled, in-progress, complete)
- ⬜ Vendor follow-up and rating
- ⬜ Service history tied to home record

### Pillar 4 — Continuity
- ⬜ Succession configuration (designate successor + confirmer)
- ⬜ Voluntary transfer flow
- ⬜ Incapacity request flow (two-person confirmation)
- ⬜ Emergency access flow
- ⬜ Prompt engine v2 (plan-triggered + family-triggered)

### Total Care Extras
- ⬜ Concierge dashboard (admin view for coordinating members)
- ⬜ Physical Home Companion Binder generation
- ⬜ Priority vendor scheduling

---

## Phase 4: Scale

- ⬜ Home transfer protocol (cooperative + ownership-based)
- ⬜ Location page template system (markets.json + dynamic rendering)
- ⬜ Market expansion: Colorado Springs
- ⬜ Market expansion: Fort Collins
- ⬜ Prompt engine v3 (full three-type system)
- ⬜ Analytics dashboard (members, circles, homes, retention)
- ⬜ Insurance partnership exploration

---

## Open Questions

- Framework decision: plain HTML/JS, React, or Svelte for the app?
- Mobile: responsive web first, or native app consideration?
- Offline capability: service worker for core features?
- Notification delivery: email-first, then SMS, then push?
- Maintenance template seed data: how many templates for Colorado launch?
- Admin panel: separate app or role-gated views within the same app?
- Email confirmation: on or off for launch? If on, signup must land on a "check your email" screen instead of `/onboarding` (protected route bounces with no session until confirmed).
