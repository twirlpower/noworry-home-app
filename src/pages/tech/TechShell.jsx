import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useStaffRole } from '../../hooks/useStaffRole'
import { useStaffMode } from '../../context/StaffModeContext'
import { useSyncStatus } from '../../lib/techSync'

// Mobile-first layout wrapper for all /tech/* pages. Fixed header + sync
// bar at the top, fixed bottom nav at the bottom, scrollable content in
// between. Tap targets are at least 48px tall; font sizes ≥ 16px.

const NAV_ITEMS = [
  { to: '/tech/homes',     icon: '🏠', label: 'Homes' },
  { to: '/tech/today',     icon: '📋', label: 'Today' },
  { to: '/tech/assess',    icon: '🔍', label: 'Assess' },
  { to: '/tech/checklist', icon: '✓',  label: 'Checklist' },
  { to: '/tech/profile',   icon: '👤', label: 'Me' },
]

export default function TechShell() {
  const { isStaff } = useStaffRole()
  const { setStaffMode } = useStaffMode()
  const { pendingCount, isOnline } = useSyncStatus()
  const navigate = useNavigate()

  function switchToAdmin() {
    setStaffMode('admin')
    navigate('/admin/crm')
  }

  // Sync bar copy + color
  let syncTone, syncText
  if (!isOnline) {
    syncTone = 'red'
    syncText = 'Offline — working locally'
  } else if (pendingCount > 0) {
    syncTone = 'amber'
    syncText = `${pendingCount} item${pendingCount === 1 ? '' : 's'} pending sync`
  } else {
    syncTone = 'green'
    syncText = 'All synced'
  }

  return (
    <div className="tech-shell">
      {isStaff && (
        <div className="tech-admin-banner" role="status">
          <span>🔧 Field Mode</span>
          <button type="button" onClick={switchToAdmin}>
            Switch to Admin →
          </button>
        </div>
      )}

      <header className="tech-header">
        <img src="/images/logo.png" alt="NoWorry Home" className="tech-header-logo" />
        <span className="tech-header-pill">Field Mode</span>
        <button
          type="button"
          className="tech-header-menu"
          aria-label="Menu"
          onClick={() => navigate('/tech/profile')}
        >
          ☰
        </button>
      </header>

      <div className={`tech-sync-bar tech-sync-${syncTone}`} role="status">
        <span className={`tech-sync-dot tech-sync-dot-${syncTone}`} aria-hidden="true" />
        <span className="tech-sync-text">{syncText}</span>
      </div>

      <main className="tech-content">
        <Outlet />
      </main>

      <nav className="tech-bottom-nav" aria-label="Field tech navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `tech-bottom-nav-item ${isActive ? 'tech-bottom-nav-item-active' : ''}`
            }
          >
            <span className="tech-bottom-nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="tech-bottom-nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
