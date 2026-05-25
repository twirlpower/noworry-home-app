import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { useCircle } from './CircleContext'
import { supabase } from '../lib/supabase'
import { availableViews } from '../utils/availableViews'
import { track } from '../lib/analytics'

// Phase 3a perspective layer — a "view" is a UI surface the user has
// chosen to operate in right now (homeowner / family / admin). It's
// distinct from the user's role in the database. A user with multiple
// available views picks one via the AppShell switcher; the choice
// persists per circle in localStorage.
//
// Phase 3c adds homeownerViewMode — orthogonal to activeView. When
// activeView === 'homeowner', this picks between the Simple and
// Standard dashboard layouts. Persisted on persons (not localStorage)
// because it's a per-person preference, not per-device.
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
  const { person } = useAuth()
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

  // Phase 3c — homeowner view density. Loaded lazily the first time
  // the user lands on the homeowner view (cheap one-column read).
  // loadedFor gates stale data the same way useStaffRole does.
  const [homeownerViewMode, setHomeownerViewModeState] = useState('standard')
  const [loadedFor, setLoadedFor] = useState(null)

  useEffect(() => {
    if (activeView !== 'homeowner') return
    if (!person?.id) return
    if (loadedFor === person.id) return
    let cancelled = false
    supabase
      .from('persons')
      .select('homeowner_view_preference')
      .eq('id', person.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setHomeownerViewModeState(data?.homeowner_view_preference ?? 'standard')
        setLoadedFor(person.id)
      })
    return () => { cancelled = true }
  }, [activeView, person?.id, loadedFor])

  function switchView(next) {
    if (!views.includes(next)) return
    if (circleId) {
      const prev = activeView
      try { localStorage.setItem(keyFor(circleId), next) } catch { /* ignore */ }
      setChoiceByCircle((m) => ({ ...m, [circleId]: next }))
      if (prev !== next) {
        track('view_switched', {
          from_view: prev,
          to_view:   next,
          circle_id: circleId,
        })
      }
    }
  }

  // Optimistic toggle for the Simple ↔ Standard dashboard switch.
  // Updates local state first so the UI flips instantly, then writes
  // through to persons.homeowner_view_preference. Failure is logged
  // but not surfaced — worst case the toggle reverts on next reload,
  // which is gentler than blocking the UI on a network blip.
  async function setHomeownerViewMode(next) {
    if (next !== 'simple' && next !== 'standard') return
    if (!person?.id) return
    setHomeownerViewModeState(next)
    try {
      await supabase
        .from('persons')
        .update({ homeowner_view_preference: next })
        .eq('id', person.id)
    } catch {
      /* swallow — see comment above */
    }
  }

  return (
    <ViewContext.Provider
      value={{
        activeView,
        views,
        switchView,
        homeownerViewMode,
        setHomeownerViewMode,
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
      homeownerViewMode: 'standard',
      setHomeownerViewMode: () => {},
      isHomeowner: false,
      isFamily: true,
      isAdmin: false,
    }
  }
  return ctx
}
