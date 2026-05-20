# NoWorry Home — App Development Roadmap

Updated: May 20, 2026 — v1.5 (Pricing locked, walkthrough findings layer added)

---

## Vision

A generational aging-in-place platform. Aware = lead. Prepared = primary revenue. Covered = brand builder + dispatch pipeline. Complete = premium relationship tier. The family — not the individual — is the customer.

---

## Architecture

- **Stack**: Supabase → Vercel → GitHub
- **Supabase ref**: hyqurxvuxhwjeqxchuuz.supabase.co
- **Local dev**: `C:\Users\tyeol\noworry-home-app` — `npm run dev -- --host`
- **Schema gotchas**: `family_circles` (not circles), `subscription_tier` (not tier), `circle_memberships` (not circle_members), `person_id` (not user_id)
- **trial_started_at / trial_ends_at / trial_emails_sent** on `family_circles` (migrations 011, 012)

---

## Tier Model — v1.5 LOCKED

| Tier | Price | Vendor Cost | Base Margin | Est. Total Margin |
|---|---|---|---|---|
| Aware | $0 | $0 | — | — |
| Prepared | $12/mo | $0 | ~100% | ~100% |
| Covered | $99/mo | $1,016/yr | $172/yr | ~$383-483/yr |
| Complete | $159/mo | $1,305/yr | $603/yr | ~$814-914/yr |

### Age Policy — No Gate
Market to 55+. Serve everyone. No age restriction on signups, pricing, or vendor services.
- Product is open to all homeowners — age verification never required
- Vendor services gated by active market availability only — not age
- Permanent home record must survive every ownership transfer regardless of new owner age
- TOS must not contain age-restrictive language — review before first non-55+ member
- Tagline works at every age — no marketing change needed
- Board unanimous May 20, 2026

### Covered ($99/mo) includes
- 2 HVAC tune-ups, 1 water heater flush, 2 gutter cleanings
- 4 filter changes (quarterly handyman dispatch)
- 1 annual safety walkthrough
- **4 seasonal walkthroughs** (45 min, same handyman, simple tasks included)
- All walkthrough findings logged to platform
- Flat rate pricing on extras
- Sprinkler activation + winterize: $79 add-on each

### Complete ($159/mo) adds
- Everything in Covered
- **4 quarterly home visits** (2 hrs each, same handyman)
  - First 30 min: seasonal walkthrough (replaces Covered walkthrough)
  - Filter check + swap included (replaces separate filter dispatch)
  - Remaining 90 min: member-directed via pre-visit app checklist
- Priority scheduling, 4hr emergency dispatch, succession, binder

### Simple tasks (locked definition)
Tasks completable in under 30 minutes, standard tools, no specialty parts, no licensed trade. In scope: tighten hardware, bulbs, GFCI reset, detector battery, door adjustment, small caulk, filter swap. Out of scope: plumbing, electrical panel, appliance repair, structural → log as finding → dispatch.

---

## Walkthrough Findings — Platform Data Layer

All seasonal walkthrough and quarterly visit findings logged permanently to the home record.

**Vendor logs after every visit:**
- Item description, location in home, severity (monitor / address soon / urgent)
- Recommended action (DIY / flat rate dispatch / licensed trade)
- Optional photo

**Three purposes:**
1. Member value — transparent home condition history
2. Dispatch pipeline — findings trigger flat rate job offers
3. Vendor performance rating — finding accuracy tracked internally; strong raters get priority assignments

---

## Success Milestones

- ⬜ First Aware signup
- ⬜ First 10 Aware signups
- ⬜ First Aware → Prepared trial conversion
- ⬜ First family member invited by a member
- ⬜ First paying member (trial → paid)
- ⬜ First 5 paying members
- ⬜ First referral partner activated
- ⬜ First vendor signed
- ⬜ First vendor dispatch
- ⬜ First walkthrough finding → dispatch conversion ← new
- ⬜ CAC recovered in 30 days

---

## What's Built

### Phase 1 — Aware ✅ COMPLETE
All Aware features built and smoke-tested. 301,218 home seeds. Custom domains live. Resend verified.

### Phase 2 — Prepared — IN PROGRESS

#### Revenue Track
- ✅ Aware→Prepared reveal moment — e37eaa5
- ✅ Trial activation (subscription_tier flip) — a1722d6
- ✅ Email drip cron (day 1, 7, 14, 28) — live, 200 OK tested
- ⬜ Stripe integration + subscription management
- ⬜ Trial expiration handler (day 31, grace period, downgrade)

#### Activation Track — CURRENT
- ⬜ Emergency contacts + RLS policy for emergency_contacts
- ⬜ Invite family during onboarding (skippable)

#### Feature Track
- ⬜ Document vault (storage bucket ready)
- ⬜ Document readiness checklist
- ⬜ Task management (create, assign, complete, comment)
- ⬜ Family notes and updates feed
- ⬜ Prompt engine v1 — home-triggered + tier-upsell nudges
- ⬜ Pre-visit checklist prompt (Complete tier)
- ⬜ Walkthrough findings log — vendor-facing entry + member-facing view
- ⬜ Internal vendor performance dashboard (findings tracking + rating)
- ⬜ Admin view — trial monitor, conversion funnel (low priority)
- ⬜ Email verification flow

### Marketing Site ✅ LIVE
- ✅ All 8 pages at www.noworry-home.com
- ⬜ Update copy: $99 Covered, $1,200+ value, walkthrough added, sprinkler add-on, quarterly visit language

### Vendor Materials
- ✅ Rate card v1.0, one-pager, partner agreement
- ⬜ Rate card v1.2 (walkthrough, $99 Covered, founder rate, findings tracking)
- ⬜ Partner agreement updated (simple tasks definition + findings logging requirement)

---

## Phase 3 — Covered + Complete (Paid Local)

- ⬜ Vendor dispatch and service tracking
- ⬜ Seasonal walkthrough job type (structured: checklist + simple tasks + findings log)
- ⬜ Complete quarterly visit job type (walkthrough + filter + member agenda)
- ⬜ Vendor portal (login, employee mgmt, credential mgmt, job assignment)
- ⬜ Pre-visit notification (member gets tech name + photo)
- ⬜ Succession configuration + emergency workflows
- ⬜ Physical Home Companion Binder generation
- ⬜ Concierge dashboard
- ⬜ Prompt engine v2 (plan-triggered + family-triggered)

---

## Phase 4 — Scale

- ⬜ Location page template system (markets.json)
- ⬜ Market expansion: Colorado Springs, Fort Collins
- ⬜ Prompt engine v3 (full three-type system)
- ⬜ Analytics dashboard
- ⬜ Insurance partnership exploration
- ⬜ Home condition dataset product (findings data at scale)

---

## Business — Parallel Track

### Immediate
- ⬜ Set up email addresses (hello@, support@, vendors@)
- ⬜ Update marketing site copy (v1.5 pricing)
- ⬜ Update vendor partner agreement (simple tasks + findings logging)

### Vendor recruitment (starts now)
- ⬜ Contact first 5 vendor candidates with rate card v1.2 + founder rate offer
- ⬜ First vendor conversation completed
- ⬜ Flat rate card validated with real vendor
- ⬜ First vendor credentialed and active

### Referral partners
- ⬜ Identify first referral partner (estate attorney or Medicare agent)
- ⬜ First conversation + one-pager sent

### Other
- ⬜ Legal review (Colorado attorney) — include TOS age-restriction review
- ⬜ Remove any age-restrictive language from TOS before first non-55+ member signs up
- ⬜ Build segmented view of 301K list by home age

---

## Schema Gotchas (confirmed from builds)

| What you might write | What the DB actually has |
|---|---|
| `circles` | `family_circles` |
| `circles.tier` | `family_circles.subscription_tier` |
| `circle_members` | `circle_memberships` |
| `circle_members.user_id` | `circle_memberships.person_id` |

`emergency_contacts` has no RLS yet — queries return count=0 silently.
Documents and Tasks pages currently render for all tiers — paywall gate lands with Stripe.

---

## Operating Constraints

Full-time job alongside. Sustainability over speed. No heroic sprints.
- Vendor recruitment: 2-3 conversations/week max
- Member outreach: OAKRAA/TTPC relationships first
- No mass campaigns until 50 members
