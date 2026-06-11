import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { identify, resetIdentity, track, getConsent } from '../lib/analytics'

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadPerson(session.user.id)
        if (event === 'SIGNED_IN' && getConsent()) {
          // Initial identify with what we know now (auth user); the
          // persons-row + circle/role properties get merged in below
          // by the person-resolved effect.
          track('user_logged_in')
        }
      } else {
        setPerson(null)
        setLoading(false)
        // Clear the PostHog distinct_id so the next user starts clean.
        resetIdentity()
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

    // Tie this browser to the persons.id distinct_id. Use the persons
    // PK (not auth.uid()) — that's what keeps a single human stable
    // across email changes, role flips, and the marketing-site →
    // app handoff. Circle/role properties get added by CircleContext
    // once memberships resolve.
    if (data?.id && getConsent()) {
      identify(data.id, {
        email: data.email,
        signup_date: data.created_at,
      })
    }
  }

  // Re-pull the current person's row after an edit (Settings → My Profile) so
  // the cached name/timezone in nav and elsewhere stays in sync.
  async function refreshPerson() {
    if (user?.id) await loadPerson(user.id)
  }

  async function signUp(email, password, firstName, lastName, phone = '') {
    // The persons row is created by the on_auth_user_created trigger from
    // user_metadata (see migrations/rls_policies_v1.sql). loadPerson() picks it up
    // once the auth session is established.
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName, phone } },
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
