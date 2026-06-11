import { supabase } from './supabase'

// Customer-facing labels for the document_type enum (schema v1.0 line 58).
// `critical: true` puts the type on the visible checklist (the "what's
// missing" gap view). Order here is the display order in the type select.
export const DOCUMENT_TYPES = {
  will:          { label: 'Will',           desc: 'Last will & testament.',                                critical: true  },
  poa_financial: { label: 'Financial POA',  desc: 'Power of attorney for financial matters.',              critical: true  },
  poa_medical:   { label: 'Medical POA',    desc: 'Healthcare proxy / medical power of attorney.',         critical: true  },
  trust:         { label: 'Trust',          desc: 'Living trust or other trust documents.',                critical: false },
  deed:          { label: 'Deed',           desc: 'Property deed.',                                        critical: true  },
  insurance:     { label: 'Insurance',      desc: 'Home, life, long-term care, etc.',                      critical: true  },
  medical:       { label: 'Medical',        desc: 'Medication list, allergy info, doctor contacts.',       critical: false },
  tax:           { label: 'Tax',            desc: 'Recent tax returns.',                                   critical: false },
  other:         { label: 'Other',          desc: 'Anything else important to keep with the family record.', critical: false },
}

export const DOCUMENT_TYPE_KEYS = Object.keys(DOCUMENT_TYPES)
export const CRITICAL_TYPE_KEYS = DOCUMENT_TYPE_KEYS.filter((k) => DOCUMENT_TYPES[k].critical)

const BUCKET = 'documents'

// Sanitize for the storage path — the bucket allows any name but stripping
// shell-unfriendly characters keeps signed URLs predictable in logs.
function sanitize(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'file'
}

// Object key = '<circle_id>/<uuid>-<sanitized-filename>'. Migration 010's
// storage.objects policies extract the first segment as the circle scope, so
// any change here MUST keep circle_id as the leading segment.
export function buildPath(circleId, file) {
  return `${circleId}/${crypto.randomUUID()}-${sanitize(file.name)}`
}

// Upload bytes + insert metadata as one transactional action. If the
// metadata insert fails (e.g. RLS rejects, doc type invalid), we roll back
// by removing the just-uploaded object so storage doesn't accumulate orphans.
export async function uploadDocument({ circleId, personId, file, title, documentType, description }) {
  const path = buildPath(circleId, file)

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (upErr) throw upErr

  const { data, error: insErr } = await supabase
    .from('documents')
    .insert({
      circle_id: circleId,
      document_type: documentType,
      title,
      description: description || null,
      file_path: path,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      uploaded_by: personId,
    })
    .select()
    .maybeSingle()

  if (insErr) {
    // Best-effort cleanup. If THIS fails too we let the user see the
    // original metadata error — the orphan file is a minor storage cost,
    // not a security issue (the storage policies still gate access).
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw insErr
  }
  if (!data) {
    // No row returned (e.g. RLS denied the RETURNING read) — clean up the
    // uploaded object so we don't orphan it, then surface the failure.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error('Document record was not created.')
  }
  return data
}

// 5-minute signed URL by default — long enough to open + read in one sitting,
// short enough that a copied URL won't outlive a single browsing session.
export async function signedUrlFor(path, expiresIn = 300) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}

// Friendly file-size formatter (whole KB under 1 MB, one decimal above).
export function formatBytes(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
