// Home health scoring — pure, deterministic, explainable.
// Aggregates four factors into a 0–100 score + traffic-light tone, and returns
// a per-factor breakdown so the UI can show *why*.

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
 * @param {object}  home    homes row (may be null)
 * @param {array}   systems active home_systems rows
 * @param {array}   scheduled  open scheduled_maintenance rows ({ due_date })
 * @param {object}  safety  { done, total }
 * @returns {{ score:number, tone:string, factors:Array }}
 */
export function computeHomeHealth(home, systems = [], scheduled = [], safety = { done: 0, total: 0 }) {
  let score = 100
  const factors = []

  // 1. System ages vs expected life.
  let endOfLife = 0
  let nearingEnd = 0
  for (const s of systems) {
    if (!s.expected_life_years || !s.install_date) continue
    const age = yearsSince(s.install_date)
    if (age == null) continue
    if (age >= s.expected_life_years) endOfLife++
    else if (age >= s.expected_life_years * 0.8) nearingEnd++
  }
  score -= endOfLife * 15 + nearingEnd * 6
  factors.push({
    label: 'System ages',
    status: endOfLife ? 'bad' : nearingEnd ? 'warn' : 'good',
    detail: endOfLife
      ? `${endOfLife} past expected life`
      : nearingEnd
        ? `${nearingEnd} nearing end of life`
        : systems.length
          ? 'All within expected life'
          : 'No systems tracked yet',
  })

  // 2. Overdue maintenance.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdue = scheduled.filter(
    (m) => m.due_date && new Date(m.due_date + 'T00:00:00') < today
  ).length
  score -= overdue * 10
  factors.push({
    label: 'Maintenance',
    status: overdue >= 3 ? 'bad' : overdue ? 'warn' : 'good',
    detail: overdue ? `${overdue} overdue` : 'Nothing overdue',
  })

  // 3. Safety checklist completion.
  const safetyPct = safety.total ? Math.round((safety.done / safety.total) * 100) : 0
  score -= Math.round((100 - safetyPct) * 0.2) // up to -20
  factors.push({
    label: 'Safety checklist',
    status: safetyPct >= 80 ? 'good' : safetyPct >= 50 ? 'warn' : 'bad',
    detail: `${safetyPct}% complete`,
  })

  // 4. Missing home profile data.
  const missing = []
  if (!home || !home.year_built) missing.push('year built')
  if (!home || !home.square_feet) missing.push('square feet')
  if (!systems.length) missing.push('home systems')
  score -= missing.length * 5
  factors.push({
    label: 'Profile completeness',
    status: missing.length >= 2 ? 'bad' : missing.length ? 'warn' : 'good',
    detail: missing.length ? `Missing ${missing.join(', ')}` : 'Complete',
  })

  score = Math.max(0, Math.min(100, Math.round(score)))
  return { score, tone: toneFromScore(score), factors }
}
