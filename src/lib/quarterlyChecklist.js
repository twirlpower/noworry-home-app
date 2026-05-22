// Quarterly checklist data + localStorage helpers for the Maintenance page.
//
// Season detection is hard-coded by month. The four buckets (per spec):
//   Spring: Mar/Apr/May    (months 2,3,4)
//   Summer: Jun/Jul/Aug    (months 5,6,7)
//   Fall:   Sep/Oct/Nov    (months 8,9,10)
//   Winter: Dec/Jan/Feb    (months 11,0,1)
//
// Storage:
//   localStorage key: nwh-quarterly-checklist
//   value: { [`q-${season}-${year}`]: [completedIndex, ...] }
//
// The year+season encoding means the checklist resets naturally each quarter
// — no cron, no purge. Last-quarter's completions stay in storage but the
// component never reads them; eventually they age out when the user clears
// site data.

export const STORAGE_KEY = 'nwh-quarterly-checklist'
export const DUE_SOON_DAYS = 30

export const SEASON_META = {
  spring: { icon: '🌱', title: 'Your Spring Checklist', dueLabel: 'Due by May 31',      dueMonth: 4,  dueDay: 31 },
  summer: { icon: '☀️', title: 'Your Summer Checklist', dueLabel: 'Due by August 31',   dueMonth: 7,  dueDay: 31 },
  fall:   { icon: '🍂', title: 'Your Fall Checklist',   dueLabel: 'Due by November 30', dueMonth: 10, dueDay: 30 },
  winter: { icon: '❄️', title: 'Your Winter Checklist', dueLabel: 'Due by February 28', dueMonth: 1,  dueDay: 28 },
}

export const SEASON_ITEMS = {
  spring: [
    'Test smoke & CO detectors',
    'Schedule AC tune-up before summer',
    'Clean gutters & downspouts',
    'Check exterior caulk & weatherstripping',
    'Turn on sprinkler system & test zones',
    'Replace HVAC filter',
  ],
  summer: [
    'Clean dryer vent',
    'Check attic ventilation',
    'Inspect roof for winter damage',
    'Test garage door safety reverse',
    'Flush water heater',
    'Check window & door screens',
  ],
  fall: [
    'Schedule furnace/HVAC tune-up',
    'Winterize sprinkler system',
    'Clean gutters after leaves fall',
    'Replace smoke/CO detector batteries',
    'Check weatherstripping on all doors',
    'Stock ice melt and snow supplies',
  ],
  winter: [
    'Replace HVAC filter',
    'Test smoke & CO detectors',
    'Check pipe insulation in unheated spaces',
    'Inspect water heater for corrosion',
    'Clear dryer vent of lint buildup',
    'Check sump pump if applicable',
  ],
}

export function currentSeason(now = new Date()) {
  const m = now.getMonth()
  if (m >= 2 && m <= 4)  return 'spring'
  if (m >= 5 && m <= 7)  return 'summer'
  if (m >= 8 && m <= 10) return 'fall'
  return 'winter'
}

// Quarter id rolls forward with the year. Winter spans Dec→Feb of the
// next calendar year — we always anchor on December's year so a Jan/Feb
// continuation of the same winter quarter doesn't create a new bucket.
export function quarterId(now = new Date()) {
  const season = currentSeason(now)
  const m = now.getMonth()
  let year = now.getFullYear()
  if (season === 'winter' && (m === 0 || m === 1)) year -= 1
  return `q-${season}-${year}`
}

// Due date as an actual Date for "is it within 30 days?" checks.
export function dueDate(now = new Date()) {
  const season = currentSeason(now)
  const meta = SEASON_META[season]
  let year = now.getFullYear()
  // Winter spans years — due Feb 28 of the calendar year after Dec.
  if (season === 'winter' && now.getMonth() === 11) year += 1
  return new Date(year, meta.dueMonth, meta.dueDay)
}

export function isDueSoon(now = new Date()) {
  const days = (dueDate(now).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  return days <= DUE_SOON_DAYS
}

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStorage(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // localStorage unavailable / quota — fail silent. The checkbox state
    // just won't persist across reload, which is recoverable.
  }
}

// Returns array of completed indices for the given quarter id.
export function loadCompletion(qid) {
  const store = readStorage()
  const v = store[qid]
  return Array.isArray(v) ? v : []
}

// Idempotent toggle: returns the new completion array.
export function toggleItem(qid, index, completedNow) {
  const store = readStorage()
  const current = new Set(Array.isArray(store[qid]) ? store[qid] : [])
  if (completedNow) current.add(index)
  else current.delete(index)
  const next = Array.from(current).sort((a, b) => a - b)
  store[qid] = next
  writeStorage(store)
  return next
}
