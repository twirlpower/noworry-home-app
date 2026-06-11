import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_KEYS,
  CRITICAL_TYPE_KEYS,
  uploadDocument,
  signedUrlFor,
  formatBytes,
} from '../lib/documents'

// Plan pillar = Full → may upload / archive (Family Graph matrix). Family
// Member / Trusted Advisor have read; Service Partner / Helper have none.
// Enforced server-side by documents_insert / documents_update plus the
// storage.objects policies in migrations/010_documents_rls.sql.
const MANAGE_ROLES = ['home_owner', 'circle_manager', 'care_partner']

const EMPTY_FORM = {
  title: '',
  documentType: 'will',
  description: '',
}

// Translate Postgres / storage errors into the same kind of fixable hint
// that HomeProfile / Tasks use when an RLS migration is missing.
function dbErrorHint(message) {
  if (/bucket.*not.*found|resource.*not.*found/i.test(message))
    return 'Could not access the documents bucket. Run migrations/010_documents_rls.sql in Supabase.'
  if (/row-level security|permission denied/i.test(message))
    return 'The documents security policy is not deployed. Run migrations/010_documents_rls.sql in Supabase.'
  return message
}

const DOC_SELECT =
  'id, document_type, title, description, file_path, file_size_bytes, ' +
  'mime_type, uploaded_by, created_at, is_archived, ' +
  'uploader:persons!uploaded_by (first_name, last_name)'

export default function Documents() {
  const { person } = useAuth()
  const { activeCircle, membership } = useCircle()
  const canManage = MANAGE_ROLES.includes(membership?.role)

  const [docs, setDocs] = useState([])
  // Derived loading flag (no setState in effect body — strict ruleset).
  const [loadedFor, setLoadedFor] = useState(null)
  const loading = !!activeCircle && loadedFor !== activeCircle.id

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!activeCircle) return
    let cancelled = false
    const circleId = activeCircle.id
    // Disambiguated uploader embed via persons!uploaded_by — same PGRST201
    // fix used in Tasks / circle_memberships (72e6eb8).
    supabase
      .from('documents')
      .select(DOC_SELECT)
      .eq('circle_id', circleId)
      .eq('is_archived', false)
      .order('document_type')
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) {
          setError(dbErrorHint(e.message))
          setDocs([])
        } else {
          setError('')
          setDocs(data ?? [])
        }
        setLoadedFor(circleId)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle])

  async function reloadDocs() {
    const { data, error: e } = await supabase
      .from('documents')
      .select(DOC_SELECT)
      .eq('circle_id', activeCircle.id)
      .eq('is_archived', false)
      .order('document_type')
      .order('created_at', { ascending: false })
    if (e) setError(dbErrorHint(e.message))
    else setDocs(data ?? [])
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function openForm(prefillType) {
    setForm({ ...EMPTY_FORM, documentType: prefillType ?? 'will' })
    setFile(null)
    setError('')
    setNotice('')
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setFile(null)
    setError('')
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!canManage) {
      console.warn('[Documents] upload blocked: role', membership?.role)
      return
    }
    if (!file) {
      setError('Choose a file to upload.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await uploadDocument({
        circleId: activeCircle.id,
        personId: person.id,
        file,
        title: form.title.trim(),
        documentType: form.documentType,
        description: form.description.trim(),
      })
      setShowForm(false)
      setForm(EMPTY_FORM)
      setFile(null)
      setNotice(`Uploaded "${form.title.trim()}".`)
      await reloadDocs()
    } catch (err) {
      setError(dbErrorHint(err.message ?? 'Upload failed.'))
    } finally {
      setSaving(false)
    }
  }

  async function archiveDoc(d) {
    if (!canManage) {
      console.warn('[Documents] archive blocked: role', membership?.role)
      return
    }
    if (!window.confirm(
      `Remove "${d.title}" from your vault? You can contact us within 30 days if you need it restored.`
    )) return
    const { error: e } = await supabase
      .from('documents')
      .update({ is_archived: true })
      .eq('id', d.id)
    if (e) {
      setError(dbErrorHint(e.message))
      return
    }
    setNotice('Removed from your vault. Contact us within 30 days if you need it restored.')
    await reloadDocs()
  }

  async function downloadDoc(d) {
    if (!d.file_path) {
      setError('No file is attached to this entry.')
      return
    }
    try {
      const url = await signedUrlFor(d.file_path)
      // noopener: a signed URL is a bearer token in disguise — never let the
      // opened tab reach back into this one via window.opener.
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      setError(dbErrorHint(err.message ?? 'Could not generate download link.'))
    }
  }

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Documents</h1>
        <p className="page-placeholder">You don't have a Home Circle yet.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen" role="status">
          <div className="loading-spinner" />
          <p>Loading documents…</p>
        </div>
      </div>
    )
  }

  // Types that actually have docs, in enum-declared order (DOCUMENT_TYPE_KEYS).
  const typesWithDocs = DOCUMENT_TYPE_KEYS.filter((t) =>
    docs.some((d) => d.document_type === t)
  )

  return (
    <div className="page">
      <div className="doc-trust-bar" role="note">
        <span className="doc-trust-icon" aria-hidden="true">🔒</span>
        <p>
          Your documents are encrypted and stored securely on AWS. Only your
          family circle can access them — not NoWorry Home staff, not anyone
          else. Backed up automatically so nothing is ever permanently lost.
          Contact us within 30 days to restore a deleted document.
        </p>
      </div>

      <div className="page-header">
        <h1>Documents</h1>
        {canManage && !showForm && (
          <button className="btn-secondary" onClick={() => openForm()}>
            Upload Document
          </button>
        )}
      </div>

      {membership?.role === 'view_only' && (
        <p className="page-placeholder">
          You have view-only access to this home.
        </p>
      )}

      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}

      {showForm && (
        <form onSubmit={handleUpload} className="profile-section">
          <h3 className="form-subhead">Upload a document</h3>
          <label className="form-label">
            Title
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              required
              className="form-input"
              placeholder="Will (2024)"
            />
          </label>
          <label className="form-label">
            Document type
            <select
              value={form.documentType}
              onChange={(e) => setField('documentType', e.target.value)}
              required
              className="form-input"
            >
              {DOCUMENT_TYPE_KEYS.map((k) => (
                <option key={k} value={k}>{DOCUMENT_TYPES[k].label}</option>
              ))}
            </select>
          </label>
          <p className="page-placeholder">{DOCUMENT_TYPES[form.documentType]?.desc}</p>
          <label className="form-label">
            File
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="form-input"
            />
          </label>
          {file && (
            <p className="page-placeholder">
              Ready to upload: {file.name} ({formatBytes(file.size)})
            </p>
          )}
          <label className="form-label">
            Description (optional)
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              className="form-input"
              rows={2}
              placeholder="Any notes — e.g. signed copy, where the original is filed."
            />
          </label>
          <button type="submit" className="btn-primary-full" disabled={saving || !file || !form.title.trim()}>
            {saving ? 'Uploading…' : 'Upload'}
          </button>
          <button type="button" className="btn-back" onClick={closeForm} disabled={saving}>
            Cancel
          </button>
        </form>
      )}

      <div className="profile-card">
        <h3>Family Essentials</h3>
        <p className="page-placeholder">
          The core documents every family record should have. Each checkmark
          means at least one is on file.
        </p>
        <ul className="systems-list">
          {CRITICAL_TYPE_KEYS.map((type) => {
            const count = docs.filter((d) => d.document_type === type).length
            const have = count > 0
            return (
              <li key={type} className="system-row">
                <div className="system-main">
                  <span className="system-name">
                    {have ? '✓ ' : '— '}
                    {DOCUMENT_TYPES[type].label}
                  </span>
                  <span className="system-meta">
                    {have
                      ? count === 1 ? '1 document on file' : `${count} documents on file`
                      : 'Not uploaded yet'}
                  </span>
                </div>
                {canManage && (
                  <div className="system-actions">
                    <button className="btn-link" onClick={() => openForm(type)}>
                      {have ? 'Add another' : 'Upload'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="profile-card">
        <h3>All Documents ({docs.length})</h3>
        {docs.length === 0 ? (
          <p className="page-placeholder">
            {canManage
              ? 'No documents uploaded yet. Use the checklist above or the Upload button.'
              : 'No documents have been uploaded to this circle yet.'}
          </p>
        ) : (
          typesWithDocs.map((type) => (
            <div key={type}>
              <h4 className="form-subhead">{DOCUMENT_TYPES[type].label}</h4>
              <ul className="systems-list">
                {docs
                  .filter((d) => d.document_type === type)
                  .map((d) => (
                    <li key={d.id} className="system-row">
                      <div className="system-main">
                        <span className="system-name">{d.title}</span>
                        <span className="system-meta">
                          {formatBytes(d.file_size_bytes)}
                          {' · Uploaded '}
                          {new Date(d.created_at).toLocaleDateString()}
                          {d.uploader && ` by ${d.uploader.first_name} ${d.uploader.last_name}`}
                        </span>
                        {d.description && (
                          <span className="system-meta task-desc">{d.description}</span>
                        )}
                      </div>
                      <div className="system-actions">
                        <button className="btn-link" onClick={() => downloadDoc(d)}>
                          Download
                        </button>
                        {canManage && (
                          <button
                            className="btn-link btn-link-danger"
                            onClick={() => archiveDoc(d)}
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
