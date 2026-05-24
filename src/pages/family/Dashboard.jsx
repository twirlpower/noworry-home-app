import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCircle } from '../../context/CircleContext'
import { computeHomeHealth } from '../../lib/homeHealth'
import { SAFETY_ITEMS } from '../../lib/safetyItems'
import { getHomeDisplayName } from '../../utils/homeDisplayName'
import HealthScore from '../../components/HealthScore'

// Family view dashboard — Phase 3b.
// Emotional register: coordination, confidence, peace of mind. The
// adult-child viewer should feel like they have a clear picture of
// what's happening at the home and what needs attention.
//
// Distinct from the admin dashboard (which keeps trial bar / billing /
// upgrade prompts / payment modals) and the homeowner dashboard (which
// hides all coordination language). This one is purpose-built for the
// "I'm helping" mode.

const MS_PER_DAY = 86400000

function fmtMonthDay(s) {
  if (!s) return ''
  return new Date(s + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  })
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const due = new Date(dateStr + 'T00:00:00').getTime()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due - today.getTime()) / MS_PER_DAY)
}

export default function FamilyDashboard() {
  const { activeCircle, membership, circles } = useCircle()
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState(null)
  const [openTasks, setOpenTasks] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [contactsCount, setContactsCount] = useState(0)

  useEffect(() => {
    if (!activeCircle?.id) return
    let cancelled = false

    async function load() {
      const { data: ch } = await supabase
        .from('circle_homes')
        .select('homes(*)')
        .eq('circle_id', activeCircle.id)
        .eq('status', 'active')
        .order('is_primary', { ascending: false })

      const home = ch?.[0]?.homes ?? null

      const [systemsR, schedR, safetyR, tasksR, contactsR] = await Promise.all([
        home
          ? supabase.from('home_systems').select('*').eq('home_id', home.id).eq('is_active', true)
          : Promise.resolve({ data: [] }),
        supabase
          .from('scheduled_maintenance')
          .select('id, title, description, due_date, is_completed')
          .eq('circle_id', activeCircle.id)
          .eq('is_completed', false)
          .order('due_date', { ascending: true }),
        supabase
          .from('safety_checklist')
          .select('item_key, is_complete')
          .eq('circle_id', activeCircle.id),
        supabase
          .from('tasks')
          .select('id, title, status, due_date, assigned_to')
          .eq('circle_id', activeCircle.id)
          .neq('status', 'complete')
          .order('due_date', { ascending: true })
          .limit(20),
        supabase
          .from('emergency_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('circle_id', activeCircle.id),
      ])
      if (cancelled) return

      const scheduled = schedR.data ?? []
      const safetyDone = (safetyR.data ?? []).filter((r) => r.is_complete).length
      setHealth(
        computeHomeHealth(home, systemsR.data ?? [], scheduled, {
          done: safetyDone,
          total: SAFETY_ITEMS.length,
        })
      )
      setUpcoming(scheduled.slice(0, 4))
      setOpenTasks(tasksR.data ?? [])
      setContactsCount(contactsR.count ?? 0)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [activeCircle?.id])

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Family view</h1>
        <p>Select a circle to see what's happening.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen" role="status">
          <div className="loading-spinner" />
          <p>Loading…</p>
        </div>
      </div>
    )
  }

  // The circles[] row carries the homeowners[] decoration that
  // getHomeDisplayName needs. Same pattern legacy Dashboard uses for
  // the greeting.
  const circleRow = circles.find((c) => c.family_circles?.id === activeCircle.id)
  const homeLabel = getHomeDisplayName(
    membership?.relationship_kind,
    circleRow?.homeowners ?? [],
    activeCircle.name
  )

  const overdueTasks = openTasks.filter((t) => {
    const d = daysUntil(t.due_date)
    return d !== null && d < 0
  }).length

  return (
    <div className="page">
      <div className="page-header">
        <h1>{homeLabel}</h1>
        <p className="dash-empty" style={{ margin: '0.25rem 0 0' }}>
          Here's what's happening this week.
        </p>
      </div>

      <div className="dashboard-grid">
        <div className="dash-card dash-card-wide">
          <h3>Home Health</h3>
          <HealthScore health={health} />
        </div>

        <Link
          to="/tasks"
          className={`dash-card dash-card-link${openTasks.length === 0 ? ' dash-card-good' : overdueTasks > 0 ? ' dash-card-warn' : ''}`}
        >
          <h3>Open Tasks</h3>
          {openTasks.length === 0 ? (
            <p className="dash-card-status dash-card-status-good">No open tasks ✓</p>
          ) : (
            <>
              <p className="dash-list-row">
                <span>{openTasks.length} {openTasks.length === 1 ? 'task' : 'tasks'} open</span>
              </p>
              {overdueTasks > 0 && (
                <p className="dash-card-status dash-card-status-warn">
                  {overdueTasks} overdue
                </p>
              )}
            </>
          )}
          <span className="dash-card-link-arrow" aria-hidden="true">Open list →</span>
        </Link>

        <Link to="/emergency-contacts" className="dash-card dash-card-link">
          <h3>Emergency Contacts</h3>
          {contactsCount > 0 ? (
            <p className="dash-list-row">
              <span>{contactsCount} {contactsCount === 1 ? 'contact' : 'contacts'} on file</span>
            </p>
          ) : (
            <p className="dash-empty">Add your first contact</p>
          )}
          <span className="dash-card-link-arrow" aria-hidden="true">View all →</span>
        </Link>

        <div className="dash-card">
          <h3>Coming up at home</h3>
          {upcoming.length === 0 ? (
            <p className="dash-empty">Nothing scheduled</p>
          ) : (
            <ul className="dash-list">
              {upcoming.map((m) => (
                <li key={m.id} className="dash-list-row">
                  <span>{m.title}</span>
                  <span className="dash-list-meta">{fmtMonthDay(m.due_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {openTasks.length > 0 && (
          <div className="dash-card dash-card-wide">
            <h3>Tasks</h3>
            <ul className="dash-list">
              {openTasks.slice(0, 6).map((t) => {
                const d = daysUntil(t.due_date)
                const overdue = d !== null && d < 0
                return (
                  <li key={t.id} className="dash-list-row">
                    <Link to="/tasks" className="dash-list-link">
                      <span>{t.title}</span>
                      <span className={`dash-list-meta${overdue ? ' dash-list-meta-warn' : ''}`}>
                        {t.due_date ? fmtMonthDay(t.due_date) : 'No due date'}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            {openTasks.length > 6 && (
              <p className="dash-empty" style={{ marginTop: '0.6rem' }}>
                <Link to="/tasks">See all {openTasks.length} tasks →</Link>
              </p>
            )}
          </div>
        )}

        <div className="dash-card">
          <h3>Recent Activity</h3>
          <p className="dash-empty">Activity feed coming soon</p>
        </div>
      </div>
    </div>
  )
}
