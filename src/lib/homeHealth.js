// Home health scoring — pure, deterministic, explainable.
// Aggregates five factors into a 0–100 score + traffic-light tone, and returns
// a per-factor breakdown so the UI can show *why*. Safety and overdue
// maintenance are weighted heaviest; missing profile data is lightest.

// Default expected lifespan (years) by system_type, used when a home_system
// has no explicit expected_life_years (onboarding/seed rarely sets it).
const SYSTEM_LIFESPAN = {
  hvac: 18, // furnace/AC ~15–20
  water_heater: 10, // ~8–12
  roof: 25, // ~20–30
  plumbing: 50,
  electrical: 40,
  appliance: 12,
  security: 10,
  garage: 15,
  foundation: 100,
}

function yearsSince(dateStr) {
  if (!dateStr) return null
  const then = new Date(dateStr + 'T00:00:00')
  if (isNaN(then)) return null
  return (Date.now() - then.getTime()) / (365.25 * 86400000)
}

function toneFromScore(score) {
  if (score >= 80) return 'good'
  if (score >= 50) return 'fair'
  return 'poor'
}

/**
 * @param {object} home       homes row (may be null)
 * @param {array}  systems    active home_systems rows
 * @param {array}  scheduled  open scheduled_maintenance rows ({ due_date })
 * @param {object} safety     { done, total }
 * @returns {{ score:number, tone:string, factors:Array }}
 */
export function computeHomeHealth(home, systems = [], scheduled = [], safety = { done: 0, total: 0 }) {
  let score = 100
  const factors = []

  // 1. System ages vs expected lifespan (explicit, else by-type default).
  let endOfLife = 0
  let nearingEnd = 0
  let assessed = 0
  for (const s of systems) {
    const life = s.expected_life_years || SYSTEM_LIFESPAN[s.system_type]
    const age = yearsSince(s.install_date)
    if (!life || age == null) continue
    assessed++
    if (age >= life) endOfLife++
    else if (age >= life * 0.8) nearingEnd++
  }
  score -= Math.min(40, endOfLife * 15 + nearingEnd * 6)
  factors.push({
    label: 'System ages',
    status: endOfLife ? 'bad' : nearingEnd ? 'warn' : 'good',
    detail: endOfLife
      ? `${endOfLife} past expected life`
      : nearingEnd
        ? `${nearingEnd} nearing end of life`
        : assessed
          ? `All ${assessed} within expected life`
          : 'No dated systems to assess',
  })

  // 2. Overdue maintenance (heavy weight).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + 30)
  let overdue = 0
  let soon = 0
  for (const m of scheduled) {
    if (!m.due_date) continue
    const due = new Date(m.due_date + 'T00:00:00')
    if (due < today) overdue++
    else if (due <= horizon) soon++
  }
  score -= Math.min(40, overdue * 12)
  factors.push({
    label: 'Overdue maintenance',
    status: overdue >= 3 ? 'bad' : overdue ? 'warn' : 'good',
    detail: overdue ? `${overdue} overdue` : 'Nothing overdue',
  })

  // 3. Safety checklist completion (heavy weight).
  const safetyPct = safety.total ? Math.round((safety.done / safety.total) * 100) : 0
  score -= Math.min(25, Math.round((100 - safetyPct) * 0.25))
  factors.push({
    label: 'Safety checklist',
    status: safetyPct >= 80 ? 'good' : safetyPct >= 50 ? 'warn' : 'bad',
    detail: `${safetyPct}% complete`,
  })

  // 4. Upcoming maintenance within 30 days (light — a heads-up, not a failure).
  score -= Math.min(8, soon * 2)
  factors.push({
    label: 'Due within 30 days',
    status: soon >= 4 ? 'warn' : 'good',
    detail: soon ? `${soon} coming up` : 'Nothing in the next 30 days',
  })

  // 5. Missing home profile data (lightest weight).
  const missing = []
  if (!home || !home.year_built) missing.push('year built')
  if (!home || !home.square_feet) missing.push('square feet')
  if (!systems.length) missing.push('home systems')
  score -= missing.length * 3
  factors.push({
    label: 'Profile completeness',
    status: missing.length ? 'warn' : 'good',
    detail: missing.length ? `Missing ${missing.join(', ')}` : 'Complete',
  })

  score = Math.max(0, Math.min(100, Math.round(score)))
  return { score, tone: toneFromScore(score), factors }
}
