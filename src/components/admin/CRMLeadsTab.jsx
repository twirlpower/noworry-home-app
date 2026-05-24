import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

// New "Leads" tab: marketing-site form captures. Backed by the `leads`
// table (migration 042) — distinct from the hand-entered Prospects tab
// (crm_contacts). Triage flow: incoming lead → contacted → qualified →
// converted (into a typed CRM row) OR declined / spam.

const LEAD_TYPES = [
  ['homeowner_signup',   'Homeowner Signup'],
  ['vendor_application', 'Vendor Application'],
  ['partner_inquiry',    'Partner Inquiry'],
  ['general_contact',    'General Contact'],
]
const LEAD_TYPE_LABEL = Object.fromEntries(LEAD_TYPES)
const LEAD_TYPE_PILL_COLOR = {
  homeowner_signup:   'green',
  vendor_application: 'blue',
  partner_inquiry:    'amber',
  general_contact:    'gray',
}

const STATUSES = [
  ['new',       'New'],
  ['contacted', 'Contacted'],
  ['qualified', 'Qualified'],
  ['converted', 'Converted'],
  ['declined',  'Declined'],
  ['spam',      'Spam'],
]
const STATUS_LABEL = Object.fromEntries(STATUSES)
const STATUS_PILL_COLOR = {
  new:       'blue',
  contacted: 'gray',
  qualified: 'green',
  converted: 'dark-green',
  declined:  'light',
  spam:      'dark-red',
}

function fmtDateTime(s) {
  if (!s) return '—'
  return new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: '2-digit',
    hour: 'numeric', minute: '2-digit',
  })
}

// Map a converted-to target to a human label for the audit line.
const CONVERTED_TO_LABEL = {
  vendor:      'Vendor',
  crm_partner: 'Partner',
  crm_contact: 'Prospect',
}

export default function CRMLeadsTab({ onChange }) {
  const [leads, setLeads] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let query = supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all') query = query.eq('lead_type', typeFilter)
      if (statusFilter === 'active') query = query.in('status', ['new', 'contacted'])
      else if (statusFilter !== 'all') query = query.eq('status', statusFilter)

      const { data, error: e } = await query
      if (cancelled) return
      if (e) setError(e.message)
      else { setLeads(data ?? []); setError('') }
      setLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [typeFilter, statusFilter])

  // Client-side search by name or email — keeps the query simple and lets
  // staff filter the loaded page without round-tripping. If the lead
  // volume gets high (hundreds per day) move this server-side.
  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return leads
    return leads.filter((l) => {
      const hay = `${l.name ?? ''} ${l.email ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [leads, search])

  async function reload() {
    let query = supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (typeFilter !== 'all') query = query.eq('lead_type', typeFilter)
    if (statusFilter === 'active') query = query.in('status', ['new', 'contacted'])
    else if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    const { data, error: e } = await query
    if (e) setError(e.message)
    else { setLeads(data ?? []); setError(''); onChange?.() }
  }

  async function updateStatus(lead, nextStatus) {
    if (busyId) return
    setBusyId(lead.id); setError('')
    const update = { status: nextStatus }
    if (nextStatus === 'contacted' && !lead.contacted_at) {
      update.contacted_at = new Date().toISOString()
    }
    const { error: e } = await supabase
      .from('leads')
      .update(update)
      .eq('id', lead.id)
    setBusyId(null)
    if (e) { setError(e.message); return }
    await reload()
  }

  async function markSpam(lead) {
    if (busyId) return
    if (!confirm(`Mark "${lead.name || lead.email || 'this lead'}" as spam?`)) return
    await updateStatus(lead, 'spam')
  }

  // Convert flow: create a row in the target CRM table for the lead's
  // type, stamp the lead converted_to / converted_id / converted_at /
  // status='converted'. Audit-only — staff still has to edit the target
  // row to fill in anything beyond the form fields we have.
  async function convertLead(lead) {
    if (busyId) return
    if (!confirm(`Convert this lead into a ${convertTargetLabel(lead.lead_type)} row?`)) return
    setBusyId(lead.id); setError('')

    const payload = lead.payload || {}
    let table, row

    if (lead.lead_type === 'vendor_application') {
      table = 'vendors'
      row = {
        name:         payload.company || lead.name || '(unnamed)',
        trade:        payload.category || 'other',
        contact_name: lead.name || null,
        phone:        lead.phone || null,
        email:        lead.email || null,
        status:       'prospect',
        notes:        leadConversionNote(lead),
      }
    } else if (lead.lead_type === 'partner_inquiry') {
      table = 'crm_partners'
      row = {
        name:         lead.name || '(unnamed)',
        organization: payload.organization || null,
        type:         payload.profession || null,
        notes:        leadConversionNote(lead),
      }
    } else {
      // homeowner_signup + general_contact both land as prospects.
      table = 'crm_contacts'
      row = {
        name:    lead.name || '(unnamed)',
        phone:   lead.phone || null,
        email:   lead.email || null,
        source:  'website',
        status:  'lead',
        notes:   leadConversionNote(lead),
      }
    }

    const ins = await supabase.from(table).insert(row).select().single()
    if (ins.error) { setError(ins.error.message); setBusyId(null); return }

    const upd = await supabase
      .from('leads')
      .update({
        status:        'converted',
        converted_at:  new Date().toISOString(),
        converted_to:  table === 'vendors' ? 'vendor'
                     : table === 'crm_partners' ? 'crm_partner'
                     : 'crm_contact',
        converted_id:  ins.data.id,
      })
      .eq('id', lead.id)

    setBusyId(null)
    if (upd.error) { setError(upd.error.message); return }
    await reload()
  }

  if (!loaded) {
    return (
      <div className="admin-loading" role="status">
        <div className="loading-spinner" />
        <p>Loading leads…</p>
      </div>
    )
  }

  return (
    <div className="admin-tab">
      <div className="admin-tab-header">
        <h2>Leads <span className="admin-count">({visibleLeads.length})</span></h2>
      </div>

      <div className="form-row form-row-3" style={{ marginBottom: '1rem' }}>
        <label className="form-label">
          Type
          <select className="form-input" value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {LEAD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="form-label">
          Status
          <select className="form-input" value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="active">Active (new + contacted)</option>
            <option value="all">All statuses</option>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="form-label">
          Search
          <input type="text" className="form-input" placeholder="Name or email"
                 value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {visibleLeads.length === 0 ? (
        <p className="page-placeholder">No leads match these filters.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Received</th><th>Type</th><th>Name</th>
                <th>Contact</th><th>Source</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleLeads.map((l) => {
                const open = expandedId === l.id
                const typeColor = LEAD_TYPE_PILL_COLOR[l.lead_type] ?? 'gray'
                const statusColor = STATUS_PILL_COLOR[l.status] ?? 'gray'
                return (
                  <Fragment key={l.id}>
                    <tr className={open ? 'admin-row-open' : ''}
                        onClick={() => setExpandedId(open ? null : l.id)}>
                      <td>{fmtDateTime(l.created_at)}</td>
                      <td>
                        <span className={`admin-pill admin-pill-color-${typeColor}`}>
                          {LEAD_TYPE_LABEL[l.lead_type] ?? l.lead_type}
                        </span>
                      </td>
                      <td><strong>{l.name || <em className="admin-meta">—</em>}</strong></td>
                      <td className="admin-cell-stack">
                        {l.email && <span>{l.email}</span>}
                        {l.phone && <span className="admin-meta">{l.phone}</span>}
                        {!l.email && !l.phone && <span className="admin-meta">—</span>}
                      </td>
                      <td className="admin-cell-truncate">{l.source_page || '—'}</td>
                      <td>
                        <span className={`admin-pill admin-pill-color-${statusColor}`}>
                          {STATUS_LABEL[l.status] ?? l.status}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="admin-row-expand">
                        <td colSpan={6}>
                          <LeadDetail
                            lead={l}
                            busy={busyId === l.id}
                            onStatusChange={(s) => updateStatus(l, s)}
                            onSpam={() => markSpam(l)}
                            onConvert={() => convertLead(l)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LeadDetail({ lead, busy, onStatusChange, onSpam, onConvert }) {
  const flags = Array.isArray(lead.spam_flags) ? lead.spam_flags : []
  return (
    <div className="admin-expand-body">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div>
          {lead.message && (
            <>
              <strong>Message</strong>
              <p style={{ whiteSpace: 'pre-wrap' }}>{lead.message}</p>
            </>
          )}
          {!lead.message && <em className="admin-meta">No message</em>}

          {lead.zip && <p><strong>ZIP:</strong> {lead.zip}</p>}

          {lead.payload && Object.keys(lead.payload).length > 0 && (
            <>
              <strong>Form fields</strong>
              <pre style={{
                background: '#F4F2EE', padding: '0.6rem', borderRadius: '0.4rem',
                fontSize: '0.85rem', overflow: 'auto', marginTop: '0.4rem',
              }}>{JSON.stringify(lead.payload, null, 2)}</pre>
            </>
          )}
        </div>

        <div>
          <p className="admin-meta">
            <strong>Source:</strong> {lead.source_url || lead.source_page || '—'}
          </p>
          {lead.referrer && (
            <p className="admin-meta"><strong>Referrer:</strong> {lead.referrer}</p>
          )}
          {lead.user_agent && (
            <p className="admin-meta admin-cell-truncate">
              <strong>UA:</strong> {lead.user_agent}
            </p>
          )}
          {lead.contacted_at && (
            <p className="admin-meta">
              <strong>Contacted:</strong> {fmtDateTime(lead.contacted_at)}
            </p>
          )}
          {lead.converted_at && (
            <p className="admin-meta">
              <strong>Converted:</strong> {fmtDateTime(lead.converted_at)}
              {lead.converted_to && ` → ${CONVERTED_TO_LABEL[lead.converted_to] ?? lead.converted_to}`}
            </p>
          )}
          {lead.spam_score > 0 && (
            <p className="admin-meta">
              <strong>Spam score:</strong> {lead.spam_score}
              {flags.length > 0 && ` (${flags.join(', ')})`}
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginTop: '1rem' }}
           onClick={(e) => e.stopPropagation()}>
        <label className="form-label" style={{ marginBottom: 0 }}>
          Status
          <select className="form-input" value={lead.status} disabled={busy}
                  onChange={(e) => onStatusChange(e.target.value)}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>

        {lead.status !== 'converted' && lead.status !== 'spam' && (
          <button type="button" className="btn-link" disabled={busy}
                  onClick={onConvert}>
            Convert to {convertTargetLabel(lead.lead_type)}
          </button>
        )}

        {lead.status !== 'spam' && (
          <button type="button" className="btn-link" disabled={busy}
                  onClick={onSpam}>
            Mark as spam
          </button>
        )}
      </div>
    </div>
  )
}

function convertTargetLabel(leadType) {
  if (leadType === 'vendor_application') return 'Vendor'
  if (leadType === 'partner_inquiry') return 'Partner'
  return 'Prospect'
}

function leadConversionNote(lead) {
  const parts = []
  parts.push(`Converted from website lead (${LEAD_TYPE_LABEL[lead.lead_type] ?? lead.lead_type})`)
  if (lead.source_page) parts.push(`Source: ${lead.source_page}`)
  if (lead.message) parts.push('', lead.message)
  return parts.join('\n')
}
