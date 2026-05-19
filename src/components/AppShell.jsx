import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'

export default function AppShell() {
  const { person, signOut } = useAuth()
  const { circles, activeCircle, switchCircle } = useCircle()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <nav className="app-nav" aria-label="Primary">
        <div className="app-nav-brand">
          <img src="/images/logo.png" alt="NoWorry Home" className="app-nav-logo" />
        </div>

        {circles.length > 1 && (
          <div className="circle-switcher">
            <label htmlFor="circle-switcher" className="sr-only">Switch home circle</label>
            <select
              id="circle-switcher"
              value={activeCircle?.id || ''}
              onChange={(e) => switchCircle(e.target.value)}
              className="circle-select"
            >
              {circles.map((c) => (
                <option key={c.family_circles.id} value={c.family_circles.id}>
                  {c.family_circles.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeCircle && (
          <div className="app-nav-links">
            <NavLink to="/dashboard" className="nav-link">
              Dashboard
            </NavLink>
            <NavLink to="/home-profile" className="nav-link">
              My Home
            </NavLink>
            <NavLink to="/maintenance" className="nav-link">
              Maintenance
            </NavLink>
            <NavLink to="/safety" className="nav-link">
              Safety
            </NavLink>
            <NavLink to="/tasks" className="nav-link">
              Tasks
            </NavLink>
            <NavLink to="/circle" className="nav-link">
              My Circle
            </NavLink>
            <NavLink to="/settings" className="nav-link">
              Settings
            </NavLink>
          </div>
        )}

        <div className="app-nav-user">
          <span className="user-name">
            {person?.first_name} {person?.last_name}
          </span>
          <button onClick={handleSignOut} className="btn-sign-out">
            Sign Out
          </button>
        </div>
      </nav>

      <main className="app-main" id="main-content">
        <Outlet />
      </main>
    </div>
  )
}
