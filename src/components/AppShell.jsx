import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { useStaffRole } from '../hooks/useStaffRole'
import { useHomeTechRole } from '../hooks/useHomeTechRole'
import { useStaffMode } from '../context/StaffModeContext'
import { useView } from '../context/ViewContext'
import { VIEW_LABELS, VIEW_DESCRIPTIONS, VIEW_DEFAULT_PATH } from '../utils/availableViews'
import InstallPrompt from './InstallPrompt'
import ConsentBanner from './ConsentBanner'

const VIEW_TIP_KEY = 'noworry:viewSwitcherSeen'
import { getHomeDisplayName } from '../utils/homeDisplayName'

const ADMIN_NAV_OPEN_KEY = 'noworry-admin-nav-open'
const MEMBER_VIEW_KEY = 'nwh-staff-member-view'

// Per-view sidebar nav. Homeowner sees a minimal set focused on the
// home itself; family + admin both get the coordination tools, with
// the dashboard link diverging (Family → /family, Admin → /admin).
// Three components in three folders, not one component with conditionals.
const NAV_BY_VIEW = {
  homeowner: [
    { to: '/home',         label: 'Home' },
    { to: '/home-profile', label: 'Home Profile' },
    { to: '/settings',     label: 'Settings' },
  ],
  family: [
    { to: '/family',              label: 'Dashboard' },
    { to: '/tasks',               label: 'Tasks' },
    { to: '/circle',              label: 'My Circle' },
    { to: '/maintenance',         label: 'Maintenance' },
    { to: '/safety',              label: 'Safety' },
    { to: '/documents',           label: 'Documents' },
    { to: '/emergency-contacts',  label: 'Emergency Contacts' },
    { to: '/home-profile',        label: 'Home Profile' },
    { to: '/settings',            label: 'Settings' },
  ],
  admin: [
    { to: '/admin',               label: 'Dashboard' },
    { to: '/circle',              label: 'Members' },
    { to: '/tasks',               label: 'Tasks' },
    { to: '/maintenance',         label: 'Maintenance' },
    { to: '/safety',              label: 'Safety' },
    { to: '/documents',           label: 'Documents' },
    { to: '/emergency-contacts',  label: 'Emergency Contacts' },
    { to: '/home-profile',        label: 'Home Profile' },
    { to: '/settings',            label: 'Settings' },
  ],
}

export default function AppShell() {
  const { person, signOut } = useAuth()
  const { circles, activeCircle, switchCircle } = useCircle()
  const { isStaff, isOwner, loading: staffLoading } = useStaffRole()
  const { isHomeTech } = useHomeTechRole()
  // StaffModeContext drives the orthogonal admin↔tech shell toggle.
  const { setStaffMode } = useStaffMode()
  // ViewContext drives the perspective layer for the main shell
  // (homeowner / family / admin). Switcher renders only when 2+ views
  // are available for the current circle.
  const { activeView, views, switchView } = useView()
  const [viewTipDismissed, setViewTipDismissed] = useState(() => {
    try { return localStorage.getItem(VIEW_TIP_KEY) === '1' } catch { return true }
  })
  const navigate = useNavigate()
  const location = useLocation()

  // Staff can temporarily flip into "View as Member" mode to dogfood the
  // member experience. localStorage is the source of truth; viewMode mirrors
  // it as React state so the redirect effect re-runs when it changes and
  // the banner can render conditionally.
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(MEMBER_VIEW_KEY) === 'member' ? 'member' : 'admin'
    } catch {
      return 'admin'
    }
  })

  function enterMemberView() {
    try { localStorage.setItem(MEMBER_VIEW_KEY, 'member') } catch { /* ignore */ }
    setViewMode('member')
    navigate('/dashboard')
  }
  function exitMemberView() {
    try { localStorage.setItem(MEMBER_VIEW_KEY, 'admin') } catch { /* ignore */ }
    setViewMode('admin')
    navigate('/admin/crm')
  }

  // Defense-in-depth: even though RootRedirect routes staff to /admin/crm,
  // a staff member could still reach a member page via a bookmark, browser
  // back, or pasted URL. Bounce them back to admin. Wait on staffLoading
  // so we don't redirect during the initial Supabase lookup. Skip when:
  //   - the staff user has opted into the legacy member view, OR
  //   - the ViewContext perspective is family or homeowner (Phase 3 —
  //     dual-role staff users with a circle membership can opt into
  //     the family/homeowner surface from the new view switcher).
  useEffect(() => {
    if (staffLoading) return
    if (!isStaff) return
    if (viewMode === 'member') return
    if (activeView === 'family' || activeView === 'homeowner') return
    if (!location.pathname.startsWith('/admin')) {
      navigate('/admin/crm', { replace: true })
    }
  }, [isStaff, staffLoading, viewMode, activeView, location.pathname, navigate])

  // localStorage read is synchronous and cheap; lazy init keeps it out of an effect.
  const [adminOpen, setAdminOpen] = useState(() => {
    try {
      return localStorage.getItem(ADMIN_NAV_OPEN_KEY) === '1'
    } catch {
      return false
    }
  })

  // Mobile drawer state. The whole nav moves into a slide-out drawer
  // below 768px so an expanded staff sub-nav no longer pushes the main
  // content off-screen.
  //
  // Close UX:
  //   * Hamburger button → toggles (sets state directly).
  //   * Overlay backdrop → closes (sets state in onClick).
  //   * Any link or button inside the drawer (except the ADMIN ▾
  //     collapse toggle) → closes via the drawer's onClick delegate.
  //   * Escape key → closes, via a window keydown listener (which the
  //     react-hooks ruleset is happy with — setState inside a callback,
  //     not the effect body).
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => {
    if (!drawerOpen) return
    function onKey(e) { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])
  function handleDrawerClick(e) {
    const hit = e.target.closest('a, button')
    if (!hit) return
    // The ADMIN ▾ button toggles its own sub-nav inside the drawer;
    // don't collapse the whole drawer when the user expands it.
    if (hit.classList.contains('admin-nav-toggle')) return
    setDrawerOpen(false)
  }

  function toggleAdmin() {
    setAdminOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(ADMIN_NAV_OPEN_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <nav className="app-nav" aria-label="Primary">
        {/* Top bar — brand always; hamburger renders on mobile via CSS.
            On desktop the sidebar is permanently open, so the hamburger
            is display:none and clicking does nothing. */}
        <div className="app-nav-top">
          <div className="app-nav-brand">
            <img src="/images/logo.png" alt="NoWorry Home" className="app-nav-logo" />
          </div>
          <button
            type="button"
            className="nav-hamburger"
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={drawerOpen}
            aria-controls="primary-nav-drawer"
            onClick={() => setDrawerOpen((o) => !o)}
          >
            <span aria-hidden="true">{drawerOpen ? '✕' : '☰'}</span>
          </button>
        </div>

        {/* Drawer wraps every interactive piece of the nav. On desktop
            this is the rest of the sidebar; on mobile it slides in from
            the right when the hamburger toggles. */}
        <div
          id="primary-nav-drawer"
          className={`nav-drawer ${drawerOpen ? 'nav-drawer-open' : ''}`}
          onClick={handleDrawerClick}
        >
        {isStaff && viewMode === 'member' && (
          <div className="admin-mode-banner" role="status">
            <span>🔧 Admin Mode</span>
            <button type="button" onClick={exitMemberView}>
              Back to Admin →
            </button>
          </div>
        )}

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
                  {getHomeDisplayName(
                    c.relationship_kind,
                    c.homeowners,
                    c.family_circles.name
                  )}
                </option>
              ))}
            </select>
          </div>
        )}

        {views.length > 1 && (
          <div className="view-switcher" aria-label="Switch view">
            <p className="view-switcher-label">View</p>
            <div className="view-switcher-pills">
              {views.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`view-switcher-pill ${activeView === v ? 'on' : ''}`}
                  onClick={() => {
                    switchView(v)
                    const path = VIEW_DEFAULT_PATH[v] || '/dashboard'
                    navigate(path)
                  }}
                  aria-pressed={activeView === v}
                >
                  <span className="view-switcher-title">{VIEW_LABELS[v]}</span>
                  <span className="view-switcher-desc">{VIEW_DESCRIPTIONS[v]}</span>
                </button>
              ))}
            </div>
            {!viewTipDismissed && (
              <div className="view-switcher-tip" role="status">
                <strong>New:</strong> Switch between your views here.
                <button
                  type="button"
                  className="view-switcher-tip-dismiss"
                  onClick={() => {
                    setViewTipDismissed(true)
                    try { localStorage.setItem(VIEW_TIP_KEY, '1') } catch { /* ignore */ }
                  }}
                >
                  Got it
                </button>
              </div>
            )}
          </div>
        )}

        {(activeCircle || isStaff) && (
          <div className="app-nav-links">
            {activeCircle && (
              <>
                {(NAV_BY_VIEW[activeView] || NAV_BY_VIEW.family).map((item) => (
                  <NavLink key={item.to} to={item.to} className="nav-link">
                    {item.label}
                  </NavLink>
                ))}
              </>
            )}

            {/* Staff sub-nav: cross-circle founder/operations tools (CRM,
                Member Map, Properties, Finance, Reports). Gated on
                isStaff (truthy only when staff_accounts has an active
                row for this user_id). Hidden additionally whenever
                viewMode === 'member' so the "View as Member" dogfood
                path gives a true member-only experience. A pure
                circle_manager with no staff_accounts row never sees
                any of this. */}
            {isStaff && viewMode !== 'member' && (
              <div className="admin-nav-section">
                <button
                  type="button"
                  className="admin-nav-toggle"
                  onClick={toggleAdmin}
                  aria-expanded={adminOpen}
                >
                  <span>ADMIN</span>
                  <span className="admin-nav-caret" aria-hidden="true">
                    {adminOpen ? '▾' : '▸'}
                  </span>
                </button>
                {adminOpen && (
                  <div className="admin-nav-items">
                    <NavLink to="/admin/crm" className="nav-link">
                      <span aria-hidden="true">🗂</span> CRM
                    </NavLink>
                    <NavLink to="/admin/heatmap" className="nav-link">
                      <span aria-hidden="true">🗺</span> Member Map
                    </NavLink>
                    {isOwner && (
                      <NavLink to="/admin/properties" className="nav-link">
                        <span aria-hidden="true">🏘</span> Properties
                      </NavLink>
                    )}
                    {isOwner && (
                      <NavLink to="/admin/maintenance" className="nav-link">
                        <span aria-hidden="true">🔧</span> Maintenance
                      </NavLink>
                    )}
                    <NavLink to="/admin/members" className="nav-link">
                      <span aria-hidden="true">👥</span> Members
                    </NavLink>
                    {isOwner && (
                      <NavLink to="/admin/finance" className="nav-link">
                        <span aria-hidden="true">💰</span> Finance
                      </NavLink>
                    )}
                    {isOwner && (
                      <NavLink to="/admin/reports" className="nav-link">
                        <span aria-hidden="true">📊</span> Reports
                      </NavLink>
                    )}
                    {isOwner && (
                      <NavLink to="/admin/settings" className="nav-link">
                        <span aria-hidden="true">⚙️</span> Admin Settings
                      </NavLink>
                    )}
                    <button
                      type="button"
                      className="view-as-member-link"
                      onClick={enterMemberView}
                    >
                      <span aria-hidden="true">👤</span> View as Member →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isHomeTech && (
          <button
            type="button"
            className="switch-to-field-link"
            onClick={() => {
              setStaffMode('tech')
              navigate('/tech/homes')
            }}
          >
            <span aria-hidden="true">🔧</span> Switch to Field Mode →
          </button>
        )}

        <div className="app-nav-user">
          <span className="user-name">
            {person?.first_name} {person?.last_name}
          </span>
          <button onClick={handleSignOut} className="btn-sign-out">
            Sign Out
          </button>
        </div>
        </div> {/* /.nav-drawer */}

        {/* Backdrop — only renders on mobile when drawer is open.
            Click anywhere outside the drawer to close. */}
        {drawerOpen && (
          <button
            type="button"
            className="nav-overlay"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          />
        )}
      </nav>

      <main className="app-main" id="main-content">
        <Outlet />
      </main>

      <InstallPrompt />
      <ConsentBanner />
    </div>
  )
}
