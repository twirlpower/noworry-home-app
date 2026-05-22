// POST /api/tech/extract-system-info
// HomeTech-only OCR for appliance data plates. Takes a base64 image +
// the system_type the tech is capturing, returns extracted fields.
//
// OCR engine: Tesseract.js. Runs in the Vercel serverless container.
// First-call cold start is slow (Tesseract downloads ~10MB of English
// trained data); cachePath: '/tmp' keeps it warm for the rest of the
// container's lifetime.
//
// Failure policy: auth + env failures return their normal status codes.
// Tesseract / parsing failures return 200 with the all-nulls empty shape
// so the client falls through to manual entry without surfacing a
// scary error to the field tech.
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for the auth check)

import Tesseract from 'tesseract.js'
import { serviceClient, verifyHomeTech } from '../admin/_staff-auth.mjs'

const EMPTY = {
  manufacturer:  null,
  model_number:  null,
  serial_number: null,
  install_year:  null,
  filter_size:   null,
}

// Brand whitelist used to populate `manufacturer` from anywhere in the
// OCR text. Names are matched case-insensitively. The first hit wins —
// order with the most-common brands first.
const KNOWN_BRANDS = [
  'Carrier', 'Trane', 'Lennox', 'Rheem', 'Goodman', 'York', 'Bryant',
  'Coleman', 'Amana', 'Heil', 'Ruud', 'American Standard',
  'Bosch', 'Bradford White', 'A.O. Smith',
  'Rinnai', 'Navien', 'Noritz',
  'Whirlpool', 'GE', 'LG', 'Samsung', 'Maytag', 'Frigidaire',
]

function parseOCRText(text) {
  const result = { ...EMPTY }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  for (const line of lines) {
    // Model number — "MODEL: ABC-123", "MOD#XYZ"
    if (!result.model_number && /MODEL|MOD[:\s]/i.test(line)) {
      const m = line.match(/MODEL[:\s#]?\s*([A-Z0-9\-]+)/i)
      if (m) result.model_number = m[1]
    }

    // Serial number — "SERIAL: ...", "SER#...", "S/N ..."
    if (!result.serial_number && /SERIAL|SER[:\s]|S\/N/i.test(line)) {
      const m = line.match(/(?:SERIAL|SER|S\/N)[:\s#]?\s*([A-Z0-9\-]+)/i)
      if (m) result.serial_number = m[1]
    }

    // Filter dimensions — "16x20x1", "20X25X4"
    if (!result.filter_size) {
      const m = line.match(/(\d{1,2}[xX]\d{1,2}[xX]\d{1,4})/)
      if (m) result.filter_size = m[1]
    }
  }

  // Derive install_year from the first 4 digits of the serial number.
  // Common HVAC convention: YYWW where YY = 19/20 + 2-digit year. Only
  // accept years in [1970, current+1] as a plausibility filter.
  if (result.serial_number && !result.install_year) {
    const m = result.serial_number.match(/^(\d{4})/)
    if (m) {
      const century = parseInt(m[1].substring(0, 2), 10)
      const year4   = parseInt(m[1], 10)
      const now     = new Date().getFullYear()
      if ((century === 19 || century === 20) && year4 >= 1970 && year4 <= now + 1) {
        result.install_year = year4
      }
    }
  }

  // Brand sweep — first matching name anywhere in the text wins.
  const lower = text.toLowerCase()
  for (const brand of KNOWN_BRANDS) {
    if (lower.includes(brand.toLowerCase())) {
      result.manufacturer = brand
      break
    }
  }

  return result
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabase = serviceClient()
  if (!supabase) return res.status(500).json({ error: 'supabase_env_missing' })

  const verify = await verifyHomeTech(req, supabase)
  if (!verify.ok) return res.status(verify.status).json(verify.body)

  const { imageBase64 } = req.body ?? {}
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'missing_image' })
  }

  // Strip any data: URI prefix so Buffer.from gets clean base64.
  const cleanB64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/i, '')
  let buffer
  try {
    buffer = Buffer.from(cleanB64, 'base64')
  } catch {
    return res.status(200).json({ ...EMPTY })
  }

  try {
    const { data } = await Tesseract.recognize(buffer, 'eng', {
      logger: () => {},
      // /tmp is the only writable directory on Vercel serverless.
      // Without this, Tesseract tries to cache to cwd and fails.
      cachePath: '/tmp',
    })
    const parsed = parseOCRText(data?.text ?? '')
    return res.status(200).json(parsed)
  } catch (e) {
    console.warn('[tech/extract] tesseract failed', e?.message)
    return res.status(200).json({ ...EMPTY })
  }
}
