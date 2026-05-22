// Thin client for the /api/tech/extract-system-info proxy. The Anthropic
// key lives server-side (see api/tech/extract-system-info.mjs); the
// browser only ever talks to our own route.
//
// extractSystemInfo(file, systemType) returns:
//   { manufacturer, model_number, serial_number, install_year, filter_size }
// Any field can be null. Returns the same shape (all nulls) on failure
// rather than throwing — the assessment form just falls through to
// manual entry when OCR comes back empty.

import { supabase } from './supabase'

const EMPTY = {
  manufacturer:  null,
  model_number:  null,
  serial_number: null,
  install_year:  null,
  filter_size:   null,
}

// Read a File/Blob as a base64 string (no data: prefix needed — the proxy
// strips one if present).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const comma = result.indexOf(',')
        resolve(comma === -1 ? result : result.slice(comma + 1))
      } else {
        reject(new Error('Unexpected FileReader result'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

export async function extractSystemInfo(file, systemType) {
  if (!file) return { ...EMPTY }

  try {
    const imageBase64 = await fileToBase64(file)

    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return { ...EMPTY }

    const res = await fetch('/api/tech/extract-system-info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ imageBase64, systemType }),
    })

    if (!res.ok) return { ...EMPTY }
    const json = await res.json()
    return {
      manufacturer:  json.manufacturer  ?? null,
      model_number:  json.model_number  ?? null,
      serial_number: json.serial_number ?? null,
      install_year:  Number.isFinite(json.install_year) ? json.install_year : null,
      filter_size:   json.filter_size   ?? null,
    }
  } catch {
    return { ...EMPTY }
  }
}
