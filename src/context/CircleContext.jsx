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

  const value = {
    circles,
    activeCircle,
    membership,
    loading,
    switchCircle,
    reloadCircles: loadCircles,
  }

  return <CircleContext.Provider value={value}>{children}</CircleContext.Provider>
}

export function useCircle() {
  return useContext(CircleContext)
}
