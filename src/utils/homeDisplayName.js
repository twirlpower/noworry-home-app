// Personalized home labels for the circle switcher and any other
// "whose home is this?" surface. Single source of truth — every screen
// that wants to render "Mom & Dad's House" / "Grandma's House" /
// "Our Home" / "My Home" should call this rather than re-implement.
//
// Inputs:
//   relationship — circle_memberships.relationship_kind for the viewer
//   homeowners   — array of { first_name, gender } for home_owner +
//                  circle_manager memberships on this circle
//   circleName   — fallback when we can't construct a label
//
// gender values come from persons.gender (added in migration 038):
// 'she_her' | 'he_him' | 'they_them' | 'prefer_not_to_say' | null

export function getHomeDisplayName(relationship, homeowners = [], circleName = 'Home') {
  const count = homeowners.length

  const getMomDad = (person) => {
    if (!person) return null
    if (person.gender === 'she_her') return 'Mom'
    if (person.gender === 'he_him')  return 'Dad'
    return person.first_name || null
  }

  const getGrandparent = (person) => {
    if (!person) return null
    if (person.gender === 'she_her') return 'Grandma'
    if (person.gender === 'he_him')  return 'Grandpa'
    return person.first_name || null
  }

  const firstName = (person) => person?.first_name || null

  switch (relationship) {
    case 'self':
      return count === 2 ? 'Our Home' : 'My Home'

    case 'spouse_partner':
      return 'Our Home'

    case 'adult_child': {
      if (count === 0) return circleName
      if (count === 1) {
        const label = getMomDad(homeowners[0])
        return label ? `${label}'s House` : circleName
      }
      const p1 = getMomDad(homeowners[0])
      const p2 = getMomDad(homeowners[1])
      if (p1 && p2 && p1 !== p2) return `${p1} & ${p2}'s House`
      if (p1) return `${p1} & ${p2 || homeowners[1]?.first_name || 'Dad'}'s House`
      return circleName
    }

    case 'grandchild': {
      if (count === 0) return circleName
      if (count === 1) {
        const label = getGrandparent(homeowners[0])
        return label ? `${label}'s House` : circleName
      }
      const g1 = getGrandparent(homeowners[0])
      const g2 = getGrandparent(homeowners[1])
      if (g1 && g2 && g1 !== g2) return `${g1} & ${g2}'s House`
      return circleName
    }

    case 'sibling':
    case 'professional':
    case 'other':
    default: {
      if (count === 0) return circleName
      const name = firstName(homeowners[0])
      return name ? `${name}'s House` : circleName
    }
  }
}

// Relationship picker options for onboarding Path B. The labels are
// senior-friendly second person ("I'm their child") — copy approved
// in the Family Graph spec v1.1.
export const RELATIONSHIP_OPTIONS = [
  { value: 'adult_child',    label: "I'm their child" },
  { value: 'spouse_partner', label: "I'm their spouse or partner" },
  { value: 'grandchild',     label: "I'm their grandchild" },
  { value: 'sibling',        label: "I'm their sibling" },
  { value: 'professional',   label: "I'm a professional caregiver" },
  { value: 'other',          label: 'Other' },
]

// Dashboard / page-header greeting variant. Self + spouse get the warm
// "Welcome home" personal-pronoun form; everyone else gets
// "Welcome to {label}" using the same display-name logic.
export function getHomeGreeting(relationship, homeowners = [], circleName = 'Home') {
  if (relationship === 'self' || relationship === 'spouse_partner') {
    return 'Welcome home'
  }
  const label = getHomeDisplayName(relationship, homeowners, circleName)
  return `Welcome to ${label}`
}

// Display labels for the Settings pronoun selector.
export const GENDER_OPTIONS = [
  { value: 'she_her',           label: 'She / her' },
  { value: 'he_him',            label: 'He / him' },
  { value: 'they_them',         label: 'They / them' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]
