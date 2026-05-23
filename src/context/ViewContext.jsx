import { createContext, useContext, useState } from 'react'
import { useCircle } from './CircleContext'
import { availableViews } from '../utils/availableViews'

// Phase 3a perspective layer — a "view" is a UI surface the user has
// chosen to operate in right now (homeowner / family / admin). It's
// distinct from the user's role in the database. A user with multiple
// available views picks one via the AppShell switcher; the choice
// persists per circle in localStorage.
//
// Naming: independent of StaffModeContext, which controls the
// orthogonal staff↔tech shell toggle. A staff user in tech mode is
// on the /tech shell entirely; ViewContext only matters inside the
// main "/" shell.

const ViewContext = createContext(null)

function keyFor(circleId) {
  return `noworry:view:${circleId}`
}

export function ViewProvider({ children }) {
  const { activeCircle, membership } = useCircle()
  const circleId = activeCircle?.id ?? null
  const role = membership?.role ?? null
  const views = availableViews(role)

  // We derive activeView during render from a per-circle choice map
  // plus a localStorage fallback. This avoids the strict
  // react-hooks/set-state-in-effect rule that a useEffect-based sync
  // pattern would trip. switchView() writes through to localStorage so
  // subsequent renders (and other tabs) pick up the choice.
  const [choiceByCircle, setChoiceByCircle] = useState({})
  const explicit = circleId ? choiceByCircle[circleId] : null
  const activeView =
    (explicit && views.includes(explicit))
      ? explicit
      : initialView(circleId, views)

  function switchView(next) {
    if (!views.includes(next)) return
    if (circleId) {
      try { localStorage.setItem(keyFor(circleId), next) } catch { /* ignore */ }
      setChoiceByCircle((m) => ({ ...m, [circleId]: next }))
    }
  }

  return (
    <ViewContext.Provider
      value={{
        activeView,
        views,
        switchView,
        // Helpers most consumers want:
        isHomeowner: activeView === 'homeowner',
        isFamily:    activeView === 'family',
        isAdmin:     activeView === 'admin',
      }}
    >
      {children}
    </ViewContext.Provider>
  )
}

function initialView(circleId, views) {
  if (!circleId || views.length === 0) return views[0] ?? 'family'
  try {
    const stored = localStorage.getItem(keyFor(circleId))
    if (stored && views.includes(stored)) return stored
  } catch {
    /* localStorage unavailable — fall through */
  }
  return views[0]
}

export function useView() {
  const ctx = useContext(ViewContext)
  if (!ctx) {
    // Default-safe fallback — pages that render without a provider
    // (auth screens, the /tech shell) get a usable shape instead of
    // a throw. Phase 3 use sites all live inside ViewProvider.
    return {
      activeView: 'family',
      views: ['family'],
      switchView: () => {},
      isHomeowner: false,
      isFamily: true,
      isAdmin: false,
    }
  }
  return ctx
}
