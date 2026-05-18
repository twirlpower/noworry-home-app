import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'

export default function Dashboard() {
  const { person } = useAuth()
  const { activeCircle, membership } = useCircle()

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Welcome, {person?.first_name}</h1>
        <p>You don't have a Home Circle yet. Let's set one up.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{activeCircle.name}</h1>
        <span className="role-badge">{membership?.role?.replace(/_/g, ' ')}</span>
      </div>

      <div className="dashboard-grid">
        <div className="dash-card">
          <h3>Home Health</h3>
          <div className="health-score health-good">Good</div>
          <p>All systems on track</p>
        </div>

        <div className="dash-card">
          <h3>Upcoming Maintenance</h3>
          <p className="dash-empty">No maintenance scheduled</p>
        </div>

        <div className="dash-card">
          <h3>Open Tasks</h3>
          <p className="dash-empty">No open tasks</p>
        </div>

        <div className="dash-card">
          <h3>Recent Activity</h3>
          <p className="dash-empty">No recent activity</p>
        </div>
      </div>
    </div>
  )
}
