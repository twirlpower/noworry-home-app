# NoWorry Home — App Development Roadmap

Updated: May 18, 2026

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
- **Schema**: 19 tables, RLS enabled, all enums use customer-facing names

---

## What's Built

### Infrastructure
- ✅ Supabase project created
- ✅ GitHub repo created (twirlpower/noworry-home-app)
- ✅ Vercel project created
- ✅ Family Graph Spec v1.0 complete
- ✅ SQL schema v1.0 written (19 tables)
- ⬜ SQL schema deployed to Supabase
- ⬜ Supabase Auth configured
- ⬜ Supabase env vars added to Vercel
- ⬜ Storage buckets created (documents, avatars, proof-of-ownership)
- ⬜ RLS policies written and deployed

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
- ⬜ Path A: Self-setup → create account → create home profile → auto-create circle
- ⬜ Path B: Setting up for someone else → create account → create proxy Home Owner → create home profile → auto-create circle
- ⬜ Home profile form: address, year built, square footage, systems
- ⬜ Invite family members flow (optional, skippable)
- ⬜ Designate successor prompt (optional, skippable)

---

## Phase 1: Home Base (Free Tier)

### Pillar 1 — The Home
- ⬜ Home profile view and edit
- ⬜ Home systems list (add, edit, remove systems)
- ⬜ Maintenance calendar (auto-generated from system data + templates)
- ⬜ Safety checklist (grab bars, smoke detectors, trip hazards, etc.)
- ⬜ Home health score (simple traffic-light dashboard)
- ⬜ Seasonal maintenance reminders (Colorado-specific templates)

### Core Platform
- ⬜ Dashboard: home health score + upcoming maintenance + recent activity
- ✅ Settings: profile, notification preferences, circle management
- ⬜ Mobile responsive (senior-first: large text, high contrast, simple nav)
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
- ⬜ Family member invitation flow (email + role assignment)
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

### Vendor Portal
- ⬜ Vendor login and dashboard
- ⬜ Employee management — add/remove employees, each triggers $49 background check fee (auto-charged)
- ⬜ Credential management — upload/maintain licenses, COI, business registration with expiration tracking
- ⬜ Job assignment — vendor specifies which employee(s) will work each job before dispatch
- ⬜ Pre-visit notification — system sends member the name and photo of the person arriving before each visit
- ⬜ Job completion reporting — vendor marks complete, adds notes/photos through portal
- ⬜ Payment history and upcoming work view

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
