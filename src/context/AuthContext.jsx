import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [person, setPerson] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadPerson(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadPerson(session.user.id)
      else {
        setPerson(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadPerson(authId) {
    // maybeSingle(): 0 rows → data:null, no error (a missing persons row is a
    // recoverable state — handled in the UI — not an HTTP 406 to swallow).
    const { data } = await supabase
      .from('persons')
      .select('*')
      .eq('auth_id', authId)
      .maybeSingle()
    setPerson(data)
    setLoading(false)
  }

  // Re-pull the current person's row after an edit (Settings → My Profile) so
  // the cached name/timezone in nav and elsewhere stays in sync.
  async function refreshPerson() {
    if (user?.id) await loadPerson(user.id)
  }

  async function signUp(email, password, firstName, lastName) {
    // The persons row is created by the on_auth_user_created trigger from
    // user_metadata (see migrations/rls_policies_v1.sql). loadPerson() picks it up
    // once the auth session is established.
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName } },
    })
    if (authError) return { error: authError }
    return {}
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setPerson(null)
  }

  async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error }
  }

  const value = {
    user,
    person,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    refreshPerson,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
