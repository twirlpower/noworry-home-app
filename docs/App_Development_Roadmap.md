# NoWorry Home — App Development Roadmap

Updated: May 20, 2026 — v1.4.1 (Board of Directors review)

---

## Vision

A generational aging-in-place platform built on the Family Graph architecture. The family — not the individual — is the customer. Aware (free) is the lead funnel. Prepared ($12/mo) is the real offer. Covered and Complete are the upsell story told later.

---

## Architecture Decisions

- **Three independent entities**: Person, Home, Family Circle (see Family Graph Spec v1.0)
- **Seven roles**: Circle Manager, Care Coordinator, Trusted Contact, Family Member, Professional Advisor, Emergency Contact, View Only
- **Proxy accounts**: Home Owners who never log in — managed by Circle Manager
- **Circle isolation**: absolute privacy between circles, no data bridge
- **Permanent home record**: Carfax-for-homes — persists across ownership
- **Stack**: Supabase (PostgreSQL + Auth + Storage) → Vercel (hosting) → GitHub (code)
- **Schema**: 20 tables, RLS enabled — key gotchas: `subscription_tier` (not `tier`), `circle_memberships` (not `circle_members`), `person_id` (not `user_id`)
- **Supabase ref**: hyqurxvuxhwjeqxchuuz.supabase.co
- **Local dev**: `C:\Users\tyeol\noworry-home-app` — `npm run dev -- --host`

---

## Success Milestones

Track these explicitly. Everything else is inputs.

- ⬜ First Aware signup (organic)
- ⬜ First 10 Aware signups
- ⬜ First Aware → Prepared trial conversion
- ⬜ First family member invited by a member ← leading indicator of family value prop
- ⬜ First paying member (trial → paid)
- ⬜ First 5 paying members
- ⬜ First referral partner activated
- ⬜ First vendor signed
- ⬜ First vendor dispatch
- ⬜ CAC recovered in 30 days (organic/referral only)

---

## What's Built

### Infrastructure
- ✅ Supabase project created and configured
- ✅ GitHub repo created (twirlpower/noworry-home-app)
- ✅ Vercel project with auto-deploy from GitHub
- ✅ SQL schema v1.0 deployed (20 tables)
- ✅ RLS policies v1 + v2 deployed (7 tables)
- ✅ Migrations 003–008 deployed
- ✅ 301,218 home seeds imported (Arapahoe + Douglas County)
- ✅ Supabase Auth configured (email/password)
- ✅ Vercel env vars configured
- ✅ vercel.json SPA routing fix deployed
- ⬜ RLS for remaining 13 tables
- ⬜ Supabase storage buckets (documents, avatars, proof-of-ownership)
- ⬜ Custom domain (app.noworry-home.com) — **OVERDUE**

### Marketing Site — 8 Pages Complete
- ✅ Homepage, Services, About, Aurora/Denver location, Vendors, Privacy, Terms, Contact
- ⬜ Create marketing site repo (twirlpower/noworry-home-site)
- ⬜ Deploy to Vercel — **OVERDUE — must ship before first member conversation**

### Vendor Materials — Complete
- ✅ Vendor one-pager pitch
- ✅ Vendor flat rate card (v1.0, 22 services, 5 categories)
- ✅ Vendor partner agreement (11 clauses)

### Family Graph Specification — v1.0 Complete
- ✅ 16-section architecture document
- ✅ Three entities, seven roles, circle isolation, permanent home record, control transfer protocols

---

## Phase 1: Aware Tier (Free) — COMPLETE

### Pillar 1 — The Home
- ✅ Home profile view and edit
- ✅ Home systems (add, edit, soft-delete) with HVAC/roof auto-creation from seeds
- ✅ Maintenance calendar (auto-generated via RPC + Colorado seasonal templates)
- ✅ Safety checklist with completion tracking
- ✅ Home health score (weighted: system age, overdue maint, safety, profile)
- ✅ Seasonal DIY maintenance guide

### Core Platform
- ✅ Auth: signup, login, logout, password reset
- ✅ Dual-path onboarding (for myself vs for someone else)
- ✅ Proxy account support for non-tech homeowners
- ✅ Address autocomplete from 301K seeds
- ✅ Dashboard wired to real data
- ✅ Family invitation flow (roster + invite, status=invited)
- ✅ Circle switcher for multi-circle users
- ✅ Settings page (profile, notifications, circle rename)
- ✅ Tier labels and taglines (tiers.js)
- ✅ Mobile responsive (senior-first: large text, high contrast)
- ✅ WCAG 2.1 AA accessibility pass
- ✅ Smoke test suite: 12 steps all green

---

## Phase 2: Prepared Tier ($12/mo) — IN PROGRESS

Phase 2 is split into three tracks. Run revenue and activation in parallel. Feature track starts after revenue is solid.

### Revenue Track — do first
- ✅ Aware→Prepared reveal moment (score gap visualization) — commit e37eaa5
- ⬜ Trial activation — flip `subscription_tier` from `aware` to `prepared` on CTA click
- ⬜ Email trial drip sequence — day 1 welcome, day 7 nudge, day 14 check-in, day 28 expiry warning
- ⬜ Stripe integration — subscription management, upgrade, downgrade, cancel
- ⬜ Trial expiration handler — day 31 payment collection, grace period, downgrade if unpaid

### Activation Track — parallel with revenue track
- ⬜ Emergency contacts — prioritized list (fast to build, high perceived value)
- ⬜ RLS policy for `emergency_contacts` table
- ⬜ Invite family during onboarding (post-home-profile step, skippable)

### Feature Track — after revenue + activation are solid
- ⬜ Supabase storage bucket (prerequisite for document vault)
- ⬜ Document vault (upload, organize, tag by type)
- ⬜ Document readiness checklist (will, POA, insurance, deed — shows gaps)
- ⬜ Task management (create, assign, complete, comment)
- ⬜ Family notes and updates feed
- ⬜ Family dashboard (who's active, what's pending)
- ⬜ Prompt engine v1 (home-triggered: system age alerts)
- ⬜ Admin view — trial monitor, conversion funnel (low priority)
- ⬜ Email verification flow (proper check-your-email screen)

---

## Phase 3: Covered + Complete (Paid Local) — PLANNED

### Vendor Dispatch
- ⬜ Vendor directory (internal, admin-managed)
- ⬜ Service request flow (member → admin → vendor)
- ⬜ Service tracking (scheduled, in-progress, complete)
- ⬜ Vendor follow-up and rating
- ⬜ Service history tied to home record

### Vendor Portal
- ⬜ Vendor login and dashboard
- ⬜ Employee management (add/remove triggers $49 auto-charge)
- ⬜ Credential management (licenses, COI, expiration tracking)
- ⬜ Job assignment (specify employee before dispatch)
- ⬜ Pre-visit notification (member gets tech name + photo)
- ⬜ Job completion reporting
- ⬜ Payment history and upcoming work view

### Pillar 4 — Continuity
- ⬜ Succession configuration (designate successor + confirmer)
- ⬜ Voluntary transfer flow
- ⬜ Incapacity request flow (two-person confirmation)
- ⬜ Emergency access flow
- ⬜ Prompt engine v2 (plan-triggered + family-triggered)

### Complete Extras
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

## Business — Parallel Track

Run these alongside app dev. Do not wait for the app to be feature-complete.

### Immediate — before first member conversation
- ⬜ Set up email addresses (hello@, support@, vendors@)
- ⬜ Deploy marketing site to Vercel
- ⬜ Set up app.noworry-home.com custom domain

### Vendor recruitment (starts now — long lead time)
- ⬜ Contact first 5 vendor candidates (warm outreach)
- ⬜ First vendor conversation completed
- ⬜ First flat rate card validated with real vendor
- ⬜ First vendor credentialed and background checked
- ⬜ First vendor signed and active

### Referral partners
- ⬜ Identify first referral partner candidate (estate attorney or Medicare agent)
- ⬜ First referral partner conversation completed
- ⬜ First referral partner one-pager sent and followed up

### Other
- ⬜ Legal review of privacy policy and terms (Colorado attorney)
- ⬜ Validate flat rate card pricing with at least one vendor
- ⬜ Build segmented view of 301K list by home age for outreach readiness

---

## Schema Gotchas (confirmed from real builds)

| What you might write | What the DB actually has |
|---|---|
| `circles.tier` | `circles.subscription_tier` |
| `circle_members` | `circle_memberships` |
| `circle_members.user_id` | `circle_memberships.person_id` |

`emergency_contacts` table has no RLS policy yet — queries return count=0 silently until migration ships.

To flip Aware → Prepared: `UPDATE circles SET subscription_tier = 'prepared'`. The `circles_update` RLS policy supports this for Family-write roles — no migration needed.

---

## Operating Constraints

Everything must be achievable alongside a full-time job. Sustainability over speed. No heroic sprints.

- App dev: weekend and evening sessions in Claude + Claude Code
- Vendor recruitment: 2–3 conversations per week maximum
- Member outreach: leverage existing OAKRAA/TTPC relationships first
- Lead list outreach: no mass campaigns until 50 members
