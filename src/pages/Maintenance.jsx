import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCircle } from '../context/CircleContext'

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
  const { activeCircle } = useCircle()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
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
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle])

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
        <div className="loading-screen">
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
      </div>

      {error && <div className="auth-error">{error}</div>}

      {items.length === 0 ? (
        <div className="profile-card">
          <p className="page-placeholder">
            Nothing scheduled yet. Once you add home systems, seasonal and
            system-based maintenance reminders will appear here automatically.
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
