import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { computeHomeHealth } from '../lib/homeHealth'
import { SAFETY_ITEMS } from '../lib/safetyItems'
import HealthScore from '../components/HealthScore'

// Customer-facing role names (Family Graph spec / skill rule — never show the
// raw enum in the UI).
const ROLE_LABELS = {
  home_owner: 'Home Owner',
  circle_manager: 'Circle Manager',
  care_partner: 'Care Partner',
  service_partner: 'Service Partner',
  helper: 'Helper',
  family_member: 'Family Member',
  trusted_advisor: 'Trusted Advisor',
}

function formatDue(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  })
}

export default function Dashboard() {
  const { person } = useAuth()
  const { activeCircle, membership } = useCircle()

  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState(null)
  const [upcoming, setUpcoming] = useState([])
  const [openTasks, setOpenTasks] = useState([])

  useEffect(() => {
    if (!activeCircle) return
    let cancelled = false
    supabase
      .from('circle_homes')
      .select('homes (*)')
      .eq('circle_id', activeCircle.id)
      .eq('status', 'active')
      .order('is_primary', { ascending: false })
      .then(async ({ data: ch }) => {
        if (cancelled) return
        const home = ch?.[0]?.homes ?? null
        const [systemsR, schedR, safetyR, tasksR] = await Promise.all([
          home
            ? supabase.from('home_systems').select('*').eq('home_id', home.id).eq('is_active', true)
            : Promise.resolve({ data: [] }),
          supabase
            .from('scheduled_maintenance')
            .select('*')
            .eq('circle_id', activeCircle.id)
            .eq('is_completed', false)
            .order('due_date', { ascending: true }),
          supabase.from('safety_checklist').select('item_key, is_complete').eq('circle_id', activeCircle.id),
          supabase
            .from('tasks')
            .select('id, title, status, due_date')
            .eq('circle_id', activeCircle.id)
            .neq('status', 'complete')
            .order('due_date', { ascending: true }),
        ])
        if (cancelled) return
        const systems = systemsR.data ?? []
        const scheduled = schedR.data ?? []
        const safetyDone = (safetyR.data ?? []).filter((r) => r.is_complete).length
        setHealth(
          computeHomeHealth(home, systems, scheduled, {
            done: safetyDone,
            total: SAFETY_ITEMS.length,
          })
        )
        setUpcoming(scheduled.slice(0, 4))
        setOpenTasks(tasksR.data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle])

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Welcome, {person?.first_name}</h1>
        <p>You don't have a Home Circle yet. Let's set one up.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen" role="status">
          <div className="loading-spinner" />
          <p>Loading dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{activeCircle.name}</h1>
        <span className="role-badge">
          {ROLE_LABELS[membership?.role] ?? membership?.role}
        </span>
      </div>

      <div className="dashboard-grid">
        <div className="dash-card dash-card-wide">
          <h3>Home Health</h3>
          <HealthScore health={health} />
        </div>

        <div className="dash-card">
          <h3>Upcoming Maintenance</h3>
          {upcoming.length === 0 ? (
            <p className="dash-empty">Nothing scheduled</p>
          ) : (
            <ul className="dash-list">
              {upcoming.map((m) => (
                <li key={m.id} className="dash-list-row">
                  <span>{m.title}</span>
                  <span className="dash-list-meta">{formatDue(m.due_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-card">
          <h3>Open Tasks</h3>
          {openTasks.length === 0 ? (
            <p className="dash-empty">No open tasks</p>
          ) : (
            <ul className="dash-list">
              {openTasks.slice(0, 5).map((t) => (
                <li key={t.id} className="dash-list-row">
                  <span>{t.title}</span>
                  {t.due_date && (
                    <span className="dash-list-meta">{formatDue(t.due_date)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-card">
          <h3>Recent Activity</h3>
          <p className="dash-empty">Activity feed coming soon</p>
        </div>
      </div>
    </div>
  )
}
