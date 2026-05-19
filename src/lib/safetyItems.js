// Canonical senior-safety checklist. item_key is the stable persistence key —
// do not rename keys once shipped. Shared by the Safety page and the Dashboard
// health score (needs the total).

export const SAFETY_ITEMS = [
  { group: 'Detectors', key: 'smoke_each_level', label: 'Working smoke detector on every level' },
  { group: 'Detectors', key: 'co_detectors', label: 'Carbon monoxide detector near sleeping areas' },
  { group: 'Detectors', key: 'detectors_tested', label: 'Detectors tested in the last 6 months' },
  { group: 'Mobility', key: 'bath_grab_bars', label: 'Grab bars by toilet and in tub/shower' },
  { group: 'Mobility', key: 'stair_handrails', label: 'Secure handrails on all staircases' },
  { group: 'Mobility', key: 'nonslip_bath', label: 'Non-slip mats in bathroom' },
  { group: 'Hazards', key: 'clear_walkways', label: 'Walkways clear of cords and clutter' },
  { group: 'Hazards', key: 'secured_rugs', label: 'Rugs removed or secured (no trip hazards)' },
  { group: 'Hazards', key: 'good_lighting', label: 'Adequate lighting + night lights on paths' },
  { group: 'Hazards', key: 'water_heater_temp', label: 'Water heater set at or below 120°F' },
  { group: 'Emergency', key: 'fire_extinguisher', label: 'Accessible, in-date fire extinguisher' },
  { group: 'Emergency', key: 'emergency_numbers', label: 'Emergency numbers posted and visible' },
  { group: 'Emergency', key: 'exit_plan', label: 'Two clear exit routes from the home' },
]

export const SAFETY_GROUPS = ['Detectors', 'Mobility', 'Hazards', 'Emergency']
