// Maps a circle_role to the views that role can operate in. Order
// matters: the first item is the default when no preference is stored
// in localStorage.
//
// Phase 3a ships the architecture + the homeowner view. The family
// view is reachable but renders a placeholder until Phase 3b lands
// (and until two RLS gaps are closed — service_partner pillar-2 read
// access on emergency_contacts, and trusted_advisor "Granted Only"
// filtering — both flagged in the Phase 3 spec).

export function availableViews(role) {
  switch (role) {
    case 'home_owner':
      return ['homeowner']
    case 'circle_manager':
      // Circle managers wear multiple hats — family first because that's
      // the most common day-to-day mode; admin is there when they need
      // to make billing or membership changes; homeowner when they want
      // to dogfood what the homeowner sees.
      return ['family', 'admin', 'homeowner']
    case 'care_partner':
    case 'care_coordinator':
    case 'family_member':
      return ['family']
    case 'helper':
      // Read-only on the family surface.
      return ['family']
    case 'service_partner':
      // Task-scoped subset of the family surface.
      return ['family']
    case 'trusted_advisor':
      // Pillar-restricted, read-only.
      return ['family']
    case 'view_only':
      // Read-only across the family surface.
      return ['family']
    default:
      return ['family']
  }
}

export const VIEW_LABELS = {
  homeowner: 'Homeowner view',
  family:    'Family view',
  admin:     'Admin view',
}

export const VIEW_DESCRIPTIONS = {
  homeowner: 'Your home, your terms',
  family:    'Helping a loved one',
  admin:     'Manage members and billing',
}

// Default landing path per view. Phase 3b mints /family and /admin as
// the dedicated dashboards for those views (legacy /dashboard remains
// as a redirect alias via <ViewRouter />).
export const VIEW_DEFAULT_PATH = {
  homeowner: '/home',
  family:    '/family',
  admin:     '/admin',
}
