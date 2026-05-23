import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const CircleContext = createContext({})

export function CircleProvider({ children }) {
  const { person } = useAuth()
  const [circles, setCircles] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [membership, setMembership] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (person) loadCircles()
    else {
      setCircles([])
      setActiveCircle(null)
      setMembership(null)
      setLoading(false)
    }
  }, [person])

  async function loadCircles() {
    setLoading(true)
    const { data } = await supabase
      .from('circle_memberships')
      .select(`
        *,
        family_circles (*)
      `)
      .eq('person_id', person.id)
      .eq('status', 'active')

    const memberCircles = data || []

    // Fetch homeowners per circle (separate query because the inverse
    // join — circle_memberships → persons via role filter — isn't
    // expressible from the per-user membership query above). One round
    // trip total; cheap.
    let homeownersByCircle = {}
    const circleIds = memberCircles
      .map((c) => c.family_circles?.id)
      .filter(Boolean)
    if (circleIds.length > 0) {
      const { data: owners } = await supabase
        .from('circle_memberships')
        .select('circle_id, role, persons!person_id (first_name, gender)')
        .in('circle_id', circleIds)
        .in('role', ['home_owner', 'circle_manager'])
        .eq('status', 'active')
      homeownersByCircle = (owners ?? []).reduce((acc, row) => {
        if (!row.persons) return acc
        const list = acc[row.circle_id] || []
        // Avoid duplicates if the same person holds both home_owner and
        // circle_manager roles (rare but possible).
        if (!list.some((p) => p.first_name === row.persons.first_name && p.gender === row.persons.gender)) {
          list.push(row.persons)
        }
        acc[row.circle_id] = list
        return acc
      }, {})
    }

    // Decorate each membership with homeowners[] for downstream consumers
    // (AppShell switcher, anywhere that wants getHomeDisplayName).
    const enriched = memberCircles.map((c) => ({
      ...c,
      homeowners: homeownersByCircle[c.family_circles?.id] || [],
    }))
    setCircles(enriched)

    if (enriched.length > 0 && !activeCircle) {
      setActiveCircle(enriched[0].family_circles)
      setMembership(enriched[0])
    }

    setLoading(false)
  }

  function switchCircle(circleId) {
    const found = circles.find(c => c.family_circles.id === circleId)
    if (found) {
      setActiveCircle(found.family_circles)
      setMembership(found)
    }
  }

  // Immutably patch a cached circle (e.g. Settings rename) so the active
  // circle and switcher reflect the change without a full reload. Callers
  // must not mutate the circle objects directly (they're hook-owned state).
  function applyCircleUpdate(circleId, patch) {
    setActiveCircle((prev) =>
      prev && prev.id === circleId ? { ...prev, ...patch } : prev
    )
    setCircles((prev) =>
      prev.map((c) =>
        c.family_circles?.id === circleId
          ? { ...c, family_circles: { ...c.family_circles, ...patch } }
          : c
      )
    )
  }

  const value = {
    circles,
    activeCircle,
    membership,
    loading,
    switchCircle,
    applyCircleUpdate,
    reloadCircles: loadCircles,
  }

  return <CircleContext.Provider value={value}>{children}</CircleContext.Provider>
}

export function useCircle() {
  return useContext(CircleContext)
}
