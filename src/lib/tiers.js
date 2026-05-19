// Customer-facing subscription tier metadata. Single source of truth — UI
// never spells out the enum keys directly. Mirrors src/lib/circleRoles.js.
// Enum values themselves were renamed in migrations/008.
export const TIERS = {
  aware: {
    label: 'Aware',
    tagline: null,
    isFree: true,
  },
  prepared: {
    label: 'Prepared',
    tagline: 'Your plans organized, your family coordinated.',
    isFree: false,
  },
  covered: {
    label: 'Covered',
    tagline: null,
    isFree: false,
  },
  complete: {
    label: 'Complete',
    tagline: null,
    isFree: false,
  },
}

// Display label with a "(free)" suffix on the entry-level tier, so the UI
// can read it without baking the marketing copy into the tier name itself.
export function tierLabel(key) {
  const t = TIERS[key]
  if (!t) return key
  return t.isFree ? `${t.label} (free)` : t.label
}
