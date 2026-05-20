// Customer-facing role names (Family Graph spec / skill rule — never show the
// raw enum in the UI). Both the original v1.0 names and the v1.5 additions
// are present so existing rows render correctly while new invites use the
// updated names. care_coordinator ⇄ care_partner and view_only ⇄
// trusted_advisor are semantic equivalents until a future migration retires
// the originals.
export const ROLE_LABELS = {
  home_owner: 'Home Owner',
  circle_manager: 'Circle Manager',
  care_partner: 'Care Partner',                  // legacy v1.0 — kept for existing rows
  care_coordinator: 'Care Coordinator',          // v1.5 addition (migration 014)
  service_partner: 'Service Partner',
  helper: 'Helper',
  family_member: 'Family Member',
  trusted_advisor: 'Trusted Advisor',            // legacy v1.0 — kept for existing rows
  view_only: 'View Only',                        // v1.5 addition (migration 014)
}

// Roles an inviter can assign (Home Owner is the proxy/owner set at onboarding,
// not invited). Order intentionally most-common first. Descriptions are shown
// in the invite selector so people understand what they're granting.
// v1.5: care_coordinator and view_only added alongside care_partner and
// trusted_advisor. Once existing rows are migrated, the legacy entries can
// be dropped from the picker.
export const INVITABLE_ROLES = [
  {
    key: 'family_member',
    label: 'Family Member',
    desc: 'Can see home status and updates. Read only.',
  },
  {
    key: 'care_coordinator',
    label: 'Care Coordinator',
    desc: 'Helps manage the home and coordinate care.',
  },
  {
    key: 'care_partner',
    label: 'Care Partner (legacy)',
    desc: 'Same as Care Coordinator — kept for existing assignments.',
  },
  {
    key: 'circle_manager',
    label: 'Circle Manager',
    desc: 'Full access. Can manage members, permissions, and billing.',
  },
  {
    key: 'helper',
    label: 'Helper',
    desc: 'Can see and complete tasks assigned to them. Great for grandkids or neighbors.',
  },
  {
    key: 'service_partner',
    label: 'Service Partner',
    desc: 'For hired help. Task access only. Cannot see documents or family info.',
  },
  {
    key: 'view_only',
    label: 'View Only',
    desc: "Can see everything, can't make changes.",
  },
  {
    key: 'trusted_advisor',
    label: 'Trusted Advisor (legacy)',
    desc: 'Attorney, financial planner, etc. Same as View Only — kept for existing assignments.',
  },
]
