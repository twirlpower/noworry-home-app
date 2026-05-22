// Tech-side quarterly checklist template. Lives client-side as a versioned
// constant instead of in maintenance_templates because the existing table is
// shaped for recurring task generation (system_type / season /
// frequency_months) and serves a different purpose. The checklist version
// string is snapshotted into home_visits.checklist_version so historical
// visits stay interpretable after the template evolves.
//
// completed_on_visit: true items use a single-confirm UI (no severity sub-
// form). Everything else uses the Done / Needs Attention / N/A buttons.
// showsFilterSize on the HVAC filter row pulls home_systems.filter_size
// into the UI so the tech sees the right size at a glance.

export const CHECKLIST_VERSION = 'quarterly-v1-2026-05'

export const CATEGORY_LABELS = {
  safety:     'Safety',
  hvac:       'HVAC',
  plumbing:   'Plumbing',
  exterior:   'Exterior / Seasonal',
  electrical: 'Electrical',
  tasks:      'Simple Tasks Completed',
}

export const CATEGORY_ORDER = ['safety', 'hvac', 'plumbing', 'exterior', 'electrical', 'tasks']

export const CHECKLIST_ITEMS = [
  { id: 'safe-smoke',        category: 'safety',     title: 'Test smoke detectors — all floors' },
  { id: 'safe-co',           category: 'safety',     title: 'Test CO detectors — all floors' },
  { id: 'safe-gfci',         category: 'safety',     title: 'Test GFCI outlets — kitchen, bathrooms, garage, exterior' },
  { id: 'safe-fireext',      category: 'safety',     title: 'Check fire extinguisher — accessible and charged' },
  { id: 'safe-trips',        category: 'safety',     title: 'Check for trip hazards in main walkways' },
  { id: 'safe-handrails',    category: 'safety',     title: 'Check handrails — secure on all stairs' },

  { id: 'hvac-filter',       category: 'hvac',       title: 'Replace HVAC filter', completed_on_visit: true, showsFilterSize: true },
  { id: 'hvac-noises',       category: 'hvac',       title: 'Check furnace/AC — unusual noises or odors' },
  { id: 'hvac-thermostat',   category: 'hvac',       title: 'Check thermostat — functioning correctly' },
  { id: 'hvac-vents',        category: 'hvac',       title: 'Check vents — clear of obstructions' },

  { id: 'plumb-sinks',       category: 'plumbing',   title: 'Check under all sinks — no leaks or water damage' },
  { id: 'plumb-waterheater', category: 'plumbing',   title: 'Check water heater — no rust, leaks, or sediment odor' },
  { id: 'plumb-toilets',     category: 'plumbing',   title: 'Check toilets — no running or rocking' },
  { id: 'plumb-drains',      category: 'plumbing',   title: 'Check drains — flowing freely' },

  { id: 'ext-weather',       category: 'exterior',   title: 'Check weatherstripping — doors and windows' },
  { id: 'ext-caulking',      category: 'exterior',   title: 'Check caulking — windows, doors, penetrations' },
  { id: 'ext-gutters',       category: 'exterior',   title: 'Check gutters — visible blockage (full cleaning dispatched)' },
  { id: 'ext-lights',        category: 'exterior',   title: 'Check exterior lights — all functional' },

  { id: 'elec-panel',        category: 'electrical', title: 'Check electrical panel — no tripped breakers, no burning smell' },
  { id: 'elec-wiring',       category: 'electrical', title: 'Check visible wiring — no exposed or damaged runs' },

  { id: 'task-bulbs',        category: 'tasks',      title: 'Replace burned-out bulbs', completed_on_visit: true },
  { id: 'task-batteries',    category: 'tasks',      title: 'Swap smoke/CO detector batteries if needed', completed_on_visit: true },
  { id: 'task-hardware',     category: 'tasks',      title: 'Tighten loose hardware — hinges, handles, cabinet doors', completed_on_visit: true },
]

export const SEVERITY_OPTIONS = [
  { value: 'monitor',       label: 'Monitor',       icon: '👁' },
  { value: 'address_soon',  label: 'Address Soon',  icon: '⚡' },
  { value: 'urgent',        label: 'Urgent',        icon: '🚨' },
]

// Health-score impact (applied by the PDF report route on completion).
export const SEVERITY_POINTS = {
  monitor:      -1,
  address_soon: -2,
  urgent:       -5,
}
export const VISIT_BASE_POINTS = 5
