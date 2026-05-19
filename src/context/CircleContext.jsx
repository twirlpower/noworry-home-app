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
    setCircles(memberCircles)

    if (memberCircles.length > 0 && !activeCircle) {
      setActiveCircle(memberCircles[0].family_circles)
      setMembership(memberCircles[0])
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
