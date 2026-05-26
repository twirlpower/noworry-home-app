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

// Phase 3d — Mode model. A staff user has up to three top-level
// "modes" they move between:
//   - Family    — the regular member-side AppShell (NAV_BY_VIEW)
//   - Admin     — the staff founder area (/admin/crm, /admin/heatmap…)
//   - Field     — the field-tech app (/tech/* — separate shell)
// Pure circle_managers only have Family. Pure staff (no circle) only
// have Admin (+ Field if hometech). Dual-role users see all three.
//
// "Are we currently in Admin mode?" is derived from the URL — any
// /admin/<something> path is the founder area. /admin alone is the
// circle-admin dashboard (member-side), so excluded. URL beats state
// because there's no clean way to keep a separate flag in sync with
// browser back/forward, deep links, or refresh.
const FOUNDER_ADMIN_PATHS = [
  '/admin/crm',
  '/admin/heatmap',
  '/admin/properties',
  '/admin/maintenance',
  '/admin/members',
  '/admin/finance',
  '/admin/reports',
  '/admin/settings',
]
function isFounderAdminPath(pathname) {
  return FOUNDER_ADMIN_PATHS.some((p) => pathname.startsWith(p))
}

// Per-view sidebar nav. The dashboard link diverges by view (Homeowner
// → /home, Family → /family, Admin → /admin); the coordination tools
// (My Circle, Maintenance, Safety, Documents, Emergency Contacts) are
// shared by all three. Tasks lives only in family + admin because the
// label and copy on /tasks lean coordination-y ("assign", "track") —
// out of register for the homeowner surface.
//
// Earlier the homeowner nav was deliberately minimal (Home, Home
// Profile, Settings) on the theory that homeowners just want to know
// the house is taken care of. Field-testing showed homeowners do want
// to see what's coming up, who's in their circle, and what's been
// done — the expanded nav gives them that without forcing the
// coordination vocabulary.
const NAV_BY_VIEW = {
  homeowner: [
    { to: '/home',                label: 'Home' },
    { to: '/circle',              label: 'My Circle' },
    { to: '/maintenance',         label: 'Maintenance' },
    { to: '/safety',              label: 'Safety' },
    { to: '/vendors',             label: 'My Vendors' },
    { to: '/documents',           label: 'Documents' },
    { to: '/emergency-contacts',  label: 'Emergency Contacts' },
    { to: '/home-profile',        label: 'Home Profile' },
    { to: '/settings',            label: 'Settings' },
  ],
  family: [
    { to: '/family',              label: 'Dashboard' },
    { to: '/tasks',               label: 'Tasks' },
    { to: '/circle',              label: 'My Circle' },
    { to: '/maintenance',         label: 'Maintenance' },
    { to: '/safety',              label: 'Safety' },
    { to: '/vendors',             label: 'My Vendors' },
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
    { to: '/vendors',             label: 'My Vendors' },
    { to: '/documents',           label: 'Documents' },
    { to: '/emergency-contacts',  label: 'Emergency Contacts' },
    { to: '/home-profile',        label: 'Home Profile' },
    { to: '/settings',            label: 'Settings' },
  ],
}

export default function AppShell() {
  const { person, signOut } = useAuth()
  const { circles, activeCircle, switchCircle } = useCircle()
  const { isStaff, isOwner } = useStaffRole()
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
  const inAdminMode = isFounderAdminPath(location.pathname)

  function switchToAdmin() {
    navigate('/admin/crm')
  }
  function switchToFamily() {
    // /dashboard is the alias that ViewRouter resolves to the active
    // view's default path (/home / /family / /admin). Picks up the
    // homeowner's view preference automatically.
    navigate('/dashboard')
  }
  function switchToField() {
    setStaffMode('tech')
    navigate('/tech/homes')
  }

  // Mobile drawer state. The whole nav moves into a slide-out drawer
  // below 768px.
  //
  // Close UX:
  //   * Hamburger button → toggles (sets state directly).
  //   * In-drawer ✕ close button → closes (sets state directly).
  //   * Overlay backdrop → closes (sets state in onClick).
  //   * Any link or button inside the drawer → closes via the
  //     drawer's onClick delegate (no exceptions — every interactive
  //     element in the drawer either navigates or switches mode,
  //     and both warrant collapsing the drawer afterward).
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
    setDrawerOpen(false)
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
        {/* In-drawer close button. The hamburger at the top of the
            page also flips to ✕ when the drawer is open, but it sits
            behind the 320px drawer on mobile so it's effectively
            invisible. This button gives the user a real, visible
            target right where their eye lands when the drawer slides
            in. Display:none on desktop (the existing media query). */}
        <button
          type="button"
          className="nav-drawer-close"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        >
          <span aria-hidden="true">✕</span>
        </button>

        {circles.length > 1 && !inAdminMode && (
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

        {views.length > 1 && !inAdminMode && (
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

        {/* Main nav body. Branches on inAdminMode (URL is the source
            of truth — /admin/crm-like paths are founder area; every
            other path is the member side). In admin mode we render
            the founder admin items inline (no collapsible) so there's
            nothing to hunt for. On the member side we render the
            per-perspective nav from NAV_BY_VIEW. */}
        {inAdminMode ? (
          <div className="app-nav-links">
            <NavLink to="/admin/crm" className="nav-link">CRM</NavLink>
            <NavLink to="/admin/heatmap" className="nav-link">Member Map</NavLink>
            {isOwner && (
              <NavLink to="/admin/properties" className="nav-link">Properties</NavLink>
            )}
            {isOwner && (
              <NavLink to="/admin/maintenance" className="nav-link">Maintenance</NavLink>
            )}
            <NavLink to="/admin/members" className="nav-link">Members</NavLink>
            {isOwner && (
              <NavLink to="/admin/finance" className="nav-link">Finance</NavLink>
            )}
            {isOwner && (
              <NavLink to="/admin/reports" className="nav-link">Reports</NavLink>
            )}
            {isOwner && (
              <NavLink to="/admin/settings" className="nav-link">Admin Settings</NavLink>
            )}
          </div>
        ) : (
          activeCircle && (
            <div className="app-nav-links">
              {(NAV_BY_VIEW[activeView] || NAV_BY_VIEW.family).map((item) => (
                <NavLink key={item.to} to={item.to} className="nav-link">
                  {item.label}
                </NavLink>
              ))}
            </div>
          )
        )}

        {/* Mode switcher — bottom of drawer. Visible buttons for the
            modes the user isn't currently in, so the toggle is one
            tap. Family is only offered to staff (otherwise members
            are already in their only mode); Admin only to staff;
            Field only to home techs. Pure staff with no circle
            don't see "Switch to Family" because they have nowhere
            to go on the member side. */}
        {inAdminMode && isStaff && activeCircle && (
          <button
            type="button"
            className="mode-switch-link"
            onClick={switchToFamily}
          >
            <span aria-hidden="true">👨‍👩‍👧</span> Switch to Family →
          </button>
        )}
        {!inAdminMode && isStaff && (
          <button
            type="button"
            className="mode-switch-link"
            onClick={switchToAdmin}
          >
            <span aria-hidden="true">🗂</span> Switch to Admin →
          </button>
        )}
        {isHomeTech && (
          <button
            type="button"
            className="mode-switch-link"
            onClick={switchToField}
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
