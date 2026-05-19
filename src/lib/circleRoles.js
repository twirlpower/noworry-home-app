// Customer-facing role names (Family Graph spec — never show raw enum in UI).
export const ROLE_LABELS = {
  home_owner: 'Home Owner',
  circle_manager: 'Circle Manager',
  care_partner: 'Care Partner',
  service_partner: 'Service Partner',
  helper: 'Helper',
  family_member: 'Family Member',
  trusted_advisor: 'Trusted Advisor',
}

// Roles an inviter can assign (Home Owner is the proxy/owner set at onboarding,
// not invited). Order intentionally most-common first. Descriptions are shown
// in the invite selector so people understand what they're granting.
export const INVITABLE_ROLES = [
  {
    key: 'family_member',
    label: 'Family Member',
    desc: 'Can see home status and updates. Read only.',
  },
  {
    key: 'care_partner',
    label: 'Care Partner',
    desc: 'Can see everything, coordinate maintenance, and take action.',
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
    key: 'trusted_advisor',
    label: 'Trusted Advisor',
    desc: 'Attorney, financial planner, etc. Sees only what you specifically grant.',
  },
]
