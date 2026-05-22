import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Resolves the current user's staff role from the staff_accounts table.
// Returns { isStaff, isOwner, isReadOnly, role, staffRecord, loading }.
//
// Implementation note: the strict React-hooks ruleset forbids synchronous
// setState in an effect body, so we drive `loading` from a derived
// `loadedFor` sentinel rather than calling setLoading() up-front. Stale
// data from a previous user is masked out by gating `record` on the same
// sentinel. See memory/lint-baseline.md.
export function useStaffRole() {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id ?? null

  const [staffRecord, setStaffRecord] = useState(null)
  const [loadedFor, setLoadedFor] = useState(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('staff_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setStaffRecord(data ?? null)
        setLoadedFor(userId)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Stale data from a previous user/session is hidden until the next fetch
  // resolves — important because role drives route gating.
  const record = loadedFor === userId ? staffRecord : null
  const loading = authLoading || (userId !== null && loadedFor !== userId)

  return {
    isStaff: !!record,
    isOwner: record?.role === 'owner',
    isReadOnly: record?.role === 'readonly',
    role: record?.role ?? null,
    staffRecord: record,
    loading,
  }
}
