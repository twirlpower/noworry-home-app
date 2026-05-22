import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCircle } from '../context/CircleContext'
import QuarterlyChecklist from '../components/QuarterlyChecklist'

const GEN_ROLES = ['home_owner', 'circle_manager', 'care_partner']

function formatDue(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function bucket(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  const days = Math.round((due - today) / 86400000)
  if (days < 0) return { label: 'Overdue', cls: 'due-overdue' }
  if (days <= 30) return { label: 'This month', cls: 'due-soon' }
  return { label: 'Upcoming', cls: 'due-later' }
}

export default function Maintenance() {
  const { activeCircle, membership } = useCircle()
  const canGenerate = GEN_ROLES.includes(membership?.role)

  const [items, setItems] = useState([])
  const [homeId, setHomeId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeCircle) return
    let cancelled = false
    supabase
      .from('scheduled_maintenance')
      .select('*')
      .eq('circle_id', activeCircle.id)
      .eq('is_completed', false)
      .order('due_date', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(loadError.message)
        else setItems(data ?? [])
        // Home id (for the generate RPC) — independent of whether any
        // scheduled rows exist yet.
        supabase
          .from('circle_homes')
          .select('home_id')
          .eq('circle_id', activeCircle.id)
          .eq('status', 'active')
          .order('is_primary', { ascending: false })
          .then(({ data: ch }) => {
            if (!cancelled) setHomeId(ch?.[0]?.home_id ?? null)
          })
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle])

  async function reloadItems() {
    const { data } = await supabase
      .from('scheduled_maintenance')
      .select('*')
      .eq('circle_id', activeCircle.id)
      .eq('is_completed', false)
      .order('due_date', { ascending: true })
    setItems(data ?? [])
  }

  async function handleRefresh() {
    if (!homeId) return
    setError('')
    setRefreshing(true)
    const { error: genErr } = await supabase.rpc('generate_maintenance_for_home', {
      p_home_id: homeId,
    })
    if (genErr) {
      const missing = /could not find the function|PGRST202/i.test(genErr.message)
      setError(
        missing
          ? 'Schedule generation is not available yet — run migrations/004_maintenance_templates.sql in Supabase.'
          : genErr.message
      )
      setRefreshing(false)
      return
    }
    await reloadItems()
    setRefreshing(false)
  }

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Maintenance Calendar</h1>
        <p className="page-placeholder">You don't have a Home Circle yet.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen" role="status">
          <div className="loading-spinner" />
          <p>Loading maintenance…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Maintenance Calendar</h1>
        {canGenerate && homeId && (
          <button className="btn-secondary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh schedule'}
          </button>
        )}
      </div>

      <QuarterlyChecklist tier={activeCircle.subscription_tier} />

      {homeId && <MemberVisitHistory homeId={homeId} />}

      {error && <div className="auth-error" role="alert">{error}</div>}

      {items.length === 0 ? (
        <div className="profile-card">
          <p className="page-placeholder">
            Nothing scheduled yet. Add home systems on the My Home page, then
            use “Refresh schedule” to generate seasonal and system-based
            reminders from the maintenance templates.
          </p>
        </div>
      ) : (
        <ul className="maint-list">
          {items.map((it) => {
            const b = bucket(it.due_date)
            return (
              <li key={it.id} className="maint-row">
                <div className="maint-main">
                  <span className="maint-title">{it.title}</span>
                  {it.description && (
                    <span className="maint-desc">{it.description}</span>
                  )}
                </div>
                <div className="maint-due">
                  <span className={`due-badge ${b.cls}`}>{b.label}</span>
                  <span className="maint-date">{formatDue(it.due_date)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// Member-facing visit history block. RLS on home_visits already limits
// rows to circles the user belongs to, so the RPC returns only their
// own visits. Tone is intentionally warm — members don't see the raw
// checklist items, just the summary + a PDF link.
function MemberVisitHistory({ homeId }) {
  const [visits, setVisits] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [openingId, setOpeningId] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .rpc('get_home_visits', { p_home_id: homeId })
      .then(({ data }) => {
        if (cancelled) return
        setVisits(data ?? [])
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [homeId])

  async function openReport(v) {
    if (!v.report_pdf_path || openingId) return
    setOpeningId(v.id)
    const { data } = await supabase.storage
      .from('visit-reports')
      .createSignedUrl(v.report_pdf_path, 60 * 60)
    setOpeningId(null)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!loaded) return null
  if (visits.length === 0) return null

  return (
    <div className="profile-card">
      <h3>Visit History</h3>
      <ul className="visit-history-list">
        {visits.map((v) => {
          const dt = v.visit_date
            ? new Date(v.visit_date + 'T00:00').toLocaleDateString(undefined, {
                month: 'long', year: 'numeric',
              })
            : ''
          const flagged = v.items_flagged ?? 0
          const summary = flagged === 0
            ? 'Everything looked great ✓'
            : `${flagged} item${flagged === 1 ? '' : 's'} noted for attention ⚠`
          return (
            <li key={v.id} className="visit-history-row">
              <div className="visit-history-main">
                <strong>{dt} — Quarterly Visit</strong>
                <span className="maint-desc">{summary}</span>
                {v.tech_name && <span className="maint-desc">{v.tech_name}</span>}
              </div>
              {v.report_pdf_path && (
                <button type="button" className="btn-link" onClick={() => openReport(v)}>
                  {openingId === v.id ? 'Opening…' : 'View Report'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
