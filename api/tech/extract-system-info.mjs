// POST /api/tech/extract-system-info
// HomeTech-only proxy to Anthropic Vision. Takes a base64 image + the
// system_type the tech is capturing, returns the extracted JSON.
//
// Why proxied (not direct browser → Anthropic): putting the API key in a
// VITE_-prefixed env var would expose it to anyone with devtools. The
// server holds the key.
//
// Required env:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for the auth check)

import { serviceClient, verifyHomeTech } from '../admin/_staff-auth.mjs'

const SYSTEM_LABELS = {
  furnace:               'furnace or heating unit',
  ac:                    'air conditioning or cooling unit',
  water_heater:          'water heater',
  electrical_panel:      'electrical panel',
  washer:                'washing machine',
  dryer:                 'clothes dryer',
  refrigerator:          'refrigerator',
  dishwasher:            'dishwasher',
  sump_pump:             'sump pump',
  sprinkler_controller:  'sprinkler/irrigation controller',
}

// Defensive default in case the model returns nothing parseable.
const EMPTY = {
  manufacturer:   null,
  model_number:   null,
  serial_number:  null,
  install_year:   null,
  filter_size:    null,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabase = serviceClient()
  if (!supabase) return res.status(500).json({ error: 'supabase_env_missing' })
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'anthropic_env_missing' })
  }

  const verify = await verifyHomeTech(req, supabase)
  if (!verify.ok) return res.status(verify.status).json(verify.body)

  const { imageBase64, systemType } = req.body ?? {}
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'missing_image' })
  }

  const label = SYSTEM_LABELS[systemType] || 'home appliance'

  // Stripping any data: URI prefix so Anthropic gets the raw base64.
  const cleanB64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/i, '')

  const prompt = `This is a photo of a ${label} info label or data plate. Extract the following information and respond with ONLY a JSON object, no other text:
{
  "manufacturer": "brand name or null",
  "model_number": "model number or null",
  "serial_number": "serial number or null",
  "install_year": year as integer or null,
  "filter_size": "filter size if visible or null"
}

For install_year: many manufacturers encode the manufacture year in the serial number. Common patterns:
- First 4 digits are year+week (e.g. 2318 = 2023, week 18)
- First letter + 2 digits encode year
- Look for a manufacture date label
If you can derive the year, use it. Otherwise null.

Only return the JSON object. No explanation.`

  try {
    const anthropic = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: cleanB64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!anthropic.ok) {
      const detail = await anthropic.text().catch(() => '')
      console.error('[tech/extract] anthropic non-ok', anthropic.status, detail.slice(0, 200))
      return res.status(502).json({ error: 'ocr_failed', detail: `Anthropic returned ${anthropic.status}` })
    }

    const payload = await anthropic.json()
    const text = payload?.content?.[0]?.text ?? '{}'

    // The model is instructed to return only JSON, but defensively strip
    // any markdown fences if it slipped one in.
    const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      console.warn('[tech/extract] non-JSON response, returning empty', text.slice(0, 120))
      parsed = { ...EMPTY }
    }

    return res.status(200).json({
      manufacturer:  parsed.manufacturer  ?? null,
      model_number:  parsed.model_number  ?? null,
      serial_number: parsed.serial_number ?? null,
      install_year:  Number.isFinite(parsed.install_year) ? parsed.install_year : null,
      filter_size:   parsed.filter_size   ?? null,
    })
  } catch (e) {
    console.error('[tech/extract] error', e?.message)
    return res.status(502).json({ error: 'ocr_failed', detail: e?.message })
  }
}
