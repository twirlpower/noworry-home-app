// Hand-curated ZIP-code centroids for Aurora and the Denver Metro area.
// Values are approximate geographic centers of each ZIP polygon — accurate
// to within ~1 mile, which is fine for a neighborhood-zoom heat map.
//
// Future enhancement: replace this with a per-home lat/lng column populated
// by a geocoder, so members within a ZIP can spread out instead of stacking
// on the centroid.
//
// Format: { zip: { lat, lng, city } }

export const ZIP_CENTROIDS = {
  // ── Aurora ────────────────────────────────────────────────────────────
  '80010': { lat: 39.741, lng: -104.862, city: 'Aurora' },
  '80011': { lat: 39.741, lng: -104.795, city: 'Aurora' },
  '80012': { lat: 39.701, lng: -104.833, city: 'Aurora' },
  '80013': { lat: 39.657, lng: -104.786, city: 'Aurora' },
  '80014': { lat: 39.661, lng: -104.840, city: 'Aurora' },
  '80015': { lat: 39.608, lng: -104.810, city: 'Aurora' },
  '80016': { lat: 39.614, lng: -104.737, city: 'Aurora' },
  '80017': { lat: 39.691, lng: -104.762, city: 'Aurora' },
  '80018': { lat: 39.682, lng: -104.687, city: 'Aurora' },
  '80019': { lat: 39.779, lng: -104.686, city: 'Aurora' },

  // ── Denver ────────────────────────────────────────────────────────────
  '80202': { lat: 39.748, lng: -104.999, city: 'Denver' },
  '80203': { lat: 39.732, lng: -104.978, city: 'Denver' },
  '80204': { lat: 39.737, lng: -105.017, city: 'Denver' },
  '80205': { lat: 39.768, lng: -104.959, city: 'Denver' },
  '80206': { lat: 39.732, lng: -104.951, city: 'Denver' },
  '80207': { lat: 39.757, lng: -104.913, city: 'Denver' },
  '80209': { lat: 39.706, lng: -104.967, city: 'Denver' },
  '80210': { lat: 39.679, lng: -104.961, city: 'Denver' },
  '80211': { lat: 39.770, lng: -105.020, city: 'Denver' },
  '80212': { lat: 39.769, lng: -105.046, city: 'Denver' },
  '80218': { lat: 39.733, lng: -104.971, city: 'Denver' },
  '80220': { lat: 39.736, lng: -104.921, city: 'Denver' },
  '80222': { lat: 39.681, lng: -104.929, city: 'Denver' },
  '80224': { lat: 39.694, lng: -104.913, city: 'Denver' },
  '80230': { lat: 39.713, lng: -104.890, city: 'Denver' },
  '80231': { lat: 39.660, lng: -104.890, city: 'Denver' },
  '80237': { lat: 39.643, lng: -104.917, city: 'Denver' },
  '80238': { lat: 39.770, lng: -104.895, city: 'Denver' },
  '80246': { lat: 39.708, lng: -104.928, city: 'Denver' },
  '80247': { lat: 39.701, lng: -104.864, city: 'Denver' },

  // ── Centennial / Englewood / Greenwood Village ────────────────────────
  '80110': { lat: 39.648, lng: -105.018, city: 'Englewood' },
  '80111': { lat: 39.613, lng: -104.863, city: 'Centennial' },
  '80112': { lat: 39.585, lng: -104.842, city: 'Centennial' },
  '80113': { lat: 39.649, lng: -104.972, city: 'Englewood' },

  // ── Littleton ─────────────────────────────────────────────────────────
  '80120': { lat: 39.609, lng: -105.022, city: 'Littleton' },
  '80121': { lat: 39.602, lng: -105.001, city: 'Littleton' },
  '80122': { lat: 39.595, lng: -104.973, city: 'Littleton' },
  '80123': { lat: 39.614, lng: -105.071, city: 'Littleton' },
  '80127': { lat: 39.587, lng: -105.097, city: 'Littleton' },

  // ── Lakewood / Wheat Ridge / Golden ───────────────────────────────────
  '80214': { lat: 39.743, lng: -105.071, city: 'Lakewood' },
  '80215': { lat: 39.737, lng: -105.103, city: 'Lakewood' },
  '80226': { lat: 39.709, lng: -105.085, city: 'Lakewood' },
  '80227': { lat: 39.659, lng: -105.095, city: 'Lakewood' },
  '80228': { lat: 39.706, lng: -105.130, city: 'Lakewood' },
  '80232': { lat: 39.704, lng: -105.080, city: 'Lakewood' },
  '80033': { lat: 39.764, lng: -105.078, city: 'Wheat Ridge' },
  '80401': { lat: 39.739, lng: -105.224, city: 'Golden' },
}

// Aurora, CO — used as the default map center.
export const DEFAULT_CENTER = { lat: 39.7294, lng: -104.8319 }
export const DEFAULT_ZOOM = 11

// Caller passes a ZIP string; returns { lat, lng, city } or null if unknown.
export function centroidFor(zip) {
  if (!zip) return null
  // Strip ZIP+4 suffix if present.
  const z = String(zip).slice(0, 5)
  return ZIP_CENTROIDS[z] ?? null
}
