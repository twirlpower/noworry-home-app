// Address normalizer used by Onboarding to detect duplicates against
// existing homes. The same transformations are applied server-side by
// public.normalize_address() in migration 030, so a client lookup that
// matches normalized_address on a homes row is reliable as long as both
// sides stay in sync.
//
// Transformations:
//   - Uppercase, trim, collapse whitespace
//   - Standardize common street types to USPS-style abbreviations
//   - Strip periods, commas, hashes
//
// Limitations:
//   - Does not handle directional abbreviations (NORTH → N, etc.)
//   - Does not normalize unit/apartment numbers — that's intentional
//     so "123 MAIN ST APT 4" and "123 MAIN ST APT 5" stay distinct.

export function normalizeAddress(input) {
  if (!input) return ''

  return input
    .toUpperCase()
    .trim()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bCOURT\b/g, 'CT')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bCIRCLE\b/g, 'CIR')
    .replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bWAY\b/g, 'WY')
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
