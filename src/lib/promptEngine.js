// Prompt engine v1 — dashboard smart nudges.
//
// `evaluate(ctx)` is a pure function: given a context object with all the
// signals it needs, it returns the single highest-priority non-dismissed
// prompt object, or null. The caller (Dashboard) is responsible for
// gathering the context, persisting dismissals to localStorage, and
// rendering the result with <PromptCard>.
//
// Spec → schema adaptations (real columns, not the names in the spec):
//   * "safety_items" → safety_checklist + static SAFETY_ITEMS total. There
//     is no per-item "90 days old uncompleted" timestamp in the DB; the
//     completions table is append-on-complete. We instead trigger when
//     incomplete items exist AND the circle is older than 90 days, which
//     captures the same intent ("you've had time to address this").
//   * "maintenance_tasks" → scheduled_maintenance (is_completed, due_date).
//   * "home_systems.install_year" → install_date (year derived from it).

export const DISMISS_TTL_DAYS = 30
export const TRIAL_HONEYMOON_DAYS = 7
export const NO_TASKS_GRACE_DAYS = 14
export const SAFETY_OVERDUE_DAYS = 90
export const SYSTEM_AGING_YEARS = 15

const PREPARED_OR_BETTER = new Set(['prepared', 'covered', 'complete'])
const COVERED_OR_BETTER = new Set(['covered', 'complete'])

const dayMs = 24 * 60 * 60 * 1000

function daysBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / dayMs
}

// Returns a Map { id → dismissedAt(Date) } given an array { id, dismissedAt }.
// Entries older than DISMISS_TTL_DAYS are treated as expired (no longer
// suppressing prompts).
export function activeDismissals(dismissed, now = new Date()) {
  const out = new Map()
  if (!Array.isArray(dismissed)) return out
  for (const entry of dismissed) {
    if (!entry?.id || !entry?.dismissedAt) continue
    const at = new Date(entry.dismissedAt)
    if (Number.isNaN(at.getTime())) continue
    if (daysBetween(now, at) > DISMISS_TTL_DAYS) continue
    out.set(entry.id, at)
  }
  return out
}

function pick(prompt, suppressed) {
  if (!prompt) return null
  if (suppressed.has(prompt.id)) return null
  return prompt
}

// Build the seasonal prompt for the current month. Returns null between
// the rules (the four sets below cover every month).
function seasonalPrompt(month, year) {
  // Sep/Oct/Nov — winterize sprinklers
  if (month >= 8 && month <= 10) {
    return {
      id: `home-seasonal-fall-${year}`,
      type: 'home',
      priority: 13,
      headline: 'Time to winterize your sprinklers',
      body: 'Freezing temps can crack pipes. Schedule a blowout before the first frost.',
      cta: 'View Fall Checklist',
      ctaPath: '/maintenance',
      dismissible: true,
    }
  }
  // Dec/Jan/Feb — HVAC filter
  if (month === 11 || month === 0 || month === 1) {
    return {
      id: `home-seasonal-winter-${year}`,
      type: 'home',
      priority: 13,
      headline: 'Replace your HVAC filter this month',
      body: 'A clean filter keeps your furnace running efficiently all winter.',
      cta: 'View Maintenance',
      ctaPath: '/maintenance',
      dismissible: true,
    }
  }
  // Mar/Apr/May — AC tune-up
  if (month >= 2 && month <= 4) {
    return {
      id: `home-seasonal-spring-${year}`,
      type: 'home',
      priority: 13,
      headline: 'Time for your AC tune-up',
      body: 'Get ahead of summer heat. A spring tune-up costs less than an emergency repair in July.',
      cta: 'View Spring Checklist',
      ctaPath: '/maintenance',
      dismissible: true,
    }
  }
  // Jun/Jul/Aug — water heater flush
  return {
    id: `home-seasonal-summer-${year}`,
    type: 'home',
    priority: 13,
    headline: 'Flush your water heater this summer',
    body: 'Sediment buildup shortens water heater life. A quick flush once a year makes a difference.',
    cta: 'View Maintenance',
    ctaPath: '/maintenance',
    dismissible: true,
  }
}

export function evaluate(ctx) {
  const {
    tier,
    now = new Date(),
    circleCreatedAt,
    trialStartedAt,
    homeSystems = [],
    overdueMaintenance = [],
    safetyTotal = 0,
    safetyDone = 0,
    contactsCount = 0,
    criticalDocsCovered = 0,
    tasksCount = 0,
    dismissed = [],
  } = ctx ?? {}

  const suppressed = activeDismissals(dismissed, now)
  const circleAgeDays = circleCreatedAt
    ? daysBetween(now, new Date(circleCreatedAt))
    : Infinity
  const trialAgeDays = trialStartedAt
    ? daysBetween(now, new Date(trialStartedAt))
    : null
  const currentYear = now.getFullYear()
  const month = now.getMonth() // 0-indexed

  // Aware → Prepared upsell, constructed once so it can both (a) pre-empt the
  // always-on seasonal card below and (b) serve as the priority-30 fallback
  // when the seasonal card has been dismissed. tier === 'aware' means no
  // active trial, so trialStartedAt is usually null; the >7-day clause also
  // covers a trial that expired and reverted the circle to Aware.
  const awareUpsell =
    tier === 'aware' &&
    (trialAgeDays == null || trialAgeDays > TRIAL_HONEYMOON_DAYS)
      ? pick({
          id: 'upsell-aware-prepared',
          type: 'upsell',
          priority: 30,
          headline: 'Your plan is the missing piece',
          body: "Your home is tracked. Now protect your family's plan — documents, emergency contacts, and family coordination, all in one place.",
          cta: 'Try Prepared Free for 30 Days',
          ctaPath: '/admin',
          dismissible: true,
        }, suppressed)
      : null

  // Priority 10 — safety overdue (circle has had time to address; items
  // still incomplete).
  if (
    safetyTotal > 0 &&
    safetyDone < safetyTotal &&
    circleAgeDays >= SAFETY_OVERDUE_DAYS
  ) {
    const p = pick({
      id: 'home-safety-overdue',
      type: 'safety',
      priority: 10,
      headline: 'A safety item needs attention',
      body: "Your safety checklist has items that haven't been reviewed. A quick check keeps your home ready.",
      cta: 'Review Safety Checklist',
      ctaPath: '/safety',
      dismissible: true,
    }, suppressed)
    if (p) return p
  }

  // Priority 11 — aging system (15+ years old). First match wins.
  for (const sys of homeSystems) {
    const installDate = sys.install_date ?? sys.installDate
    if (!installDate) continue
    const installYear = new Date(installDate).getFullYear()
    if (Number.isNaN(installYear)) continue
    const age = currentYear - installYear
    if (age < SYSTEM_AGING_YEARS) continue
    const p = pick({
      id: `home-system-aging-${sys.id}`,
      type: 'home',
      priority: 11,
      headline: `Your ${sys.name} is ${age} years old`,
      body: 'Older systems can fail without warning. A seasonal checkup catches small issues before they become expensive ones.',
      cta: 'View Home Systems',
      ctaPath: '/home-profile',
      dismissible: true,
    }, suppressed)
    if (p) return p
  }

  // Priority 12 — overdue maintenance. Caller passes only items with
  // is_completed=false AND due_date < today.
  if (overdueMaintenance.length > 0) {
    const p = pick({
      id: 'home-maintenance-overdue',
      type: 'home',
      priority: 12,
      headline: 'A maintenance task is overdue',
      body: 'Staying on schedule protects your home and keeps small issues from growing.',
      cta: 'View Maintenance',
      ctaPath: '/maintenance',
      dismissible: true,
    }, suppressed)
    if (p) return p
  }

  // Priority 13 — seasonal reminder (always applicable; differs by month).
  {
    const p = pick(seasonalPrompt(month, currentYear), suppressed)
    if (p) {
      // FIX 1 — the seasonal card returns every month and would otherwise
      // bury the Aware→Prepared upsell (priority 30). When we'd show the
      // seasonal card to an Aware user, show the eligible upsell instead.
      // Safety / aging-system / overdue-maintenance prompts (P10-12) are
      // evaluated above and still win, so this never hides a safety nudge.
      if (awareUpsell) return awareUpsell
      return p
    }
  }

  // Priority 20 — no emergency contacts (Prepared+ only).
  if (PREPARED_OR_BETTER.has(tier) && contactsCount === 0) {
    const p = pick({
      id: 'plan-no-contacts',
      type: 'plan',
      priority: 20,
      headline: 'Add your emergency contacts',
      body: 'Your family should know who to call and in what order. It takes about 2 minutes.',
      cta: 'Add Emergency Contacts',
      ctaPath: '/emergency-contacts',
      dismissible: true,
    }, suppressed)
    if (p) return p
  }

  // Priority 21 — fewer than 2 critical document types uploaded.
  if (PREPARED_OR_BETTER.has(tier) && criticalDocsCovered < 2) {
    const p = pick({
      id: 'plan-missing-docs',
      type: 'plan',
      priority: 21,
      headline: 'Your document vault is getting started',
      body: 'Upload your will or power of attorney so your family has access when it matters most.',
      cta: 'Go to Documents',
      ctaPath: '/documents',
      dismissible: true,
    }, suppressed)
    if (p) return p
  }

  // Priority 22 — no tasks for 14+ days.
  if (
    PREPARED_OR_BETTER.has(tier) &&
    tasksCount === 0 &&
    circleAgeDays >= NO_TASKS_GRACE_DAYS
  ) {
    const p = pick({
      id: 'plan-no-tasks',
      type: 'plan',
      priority: 22,
      headline: 'Keep your family in the loop',
      body: 'Add a task or note for your circle — a great way to stay connected across the miles.',
      cta: 'Go to Tasks',
      ctaPath: '/tasks',
      dismissible: true,
    }, suppressed)
    if (p) return p
  }

  // Priority 30 — Aware → Prepared. Fallback path: reached only when the
  // seasonal card above was dismissed (otherwise the P13 swap already
  // returned this). Built once as awareUpsell near the top.
  if (awareUpsell) return awareUpsell

  // Priority 31 — Prepared → Covered. Honeymoon: don't pitch in the first
  // week of trial.
  if (tier === 'prepared' && trialAgeDays != null && trialAgeDays > TRIAL_HONEYMOON_DAYS) {
    const p = pick({
      id: 'upsell-prepared-covered',
      type: 'upsell',
      priority: 31,
      headline: 'Want this done for you automatically?',
      body: 'Covered members get a vetted technician every quarter — no scheduling, no guessing, no surprises.',
      cta: "See What's Included",
      ctaPath: '/maintenance',
      dismissible: true,
    }, suppressed)
    if (p) return p
  }

  // No upsell for covered/complete — the tier is already aligned.
  if (COVERED_OR_BETTER.has(tier)) return null

  return null
}
