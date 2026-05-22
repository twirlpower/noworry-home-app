import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Mirrors useStaffRole.js. The strict React-hooks ruleset forbids
// synchronous setState in an effect body, so loading is derived from a
// loadedFor sentinel rather than being toggled up-front. Stale data from
// a previous user is masked out by gating `record` on the same sentinel.
// See memory/lint-baseline.md.

export function useHomeTechRole() {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id ?? null

  const [techRecord, setTechRecord] = useState(null)
  const [loadedFor, setLoadedFor] = useState(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('hometech_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setTechRecord(data ?? null)
        setLoadedFor(userId)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const record = loadedFor === userId ? techRecord : null
  const loading = authLoading || (userId !== null && loadedFor !== userId)

  return {
    isHomeTech: !!record,
    homeTechData: record,
    loading,
  }
}
