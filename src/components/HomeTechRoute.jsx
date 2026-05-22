import { Navigate } from 'react-router-dom'
import { useHomeTechRole } from '../hooks/useHomeTechRole'

// Route guard for /tech/*. Renders nothing while the hometech_accounts
// lookup is in flight (avoids flashing a redirect before we know the
// answer), then either renders children or sends them to /login.
//
// Per spec: non-tech users go to /login. For a signed-in non-tech this
// is a slightly dead-end UX (Login doesn't redirect-if-signed-in), but
// that's the spec's contract — they can navigate elsewhere from there.
export default function HomeTechRoute({ children }) {
  const { isHomeTech, loading } = useHomeTechRole()
  if (loading) return null
  if (!isHomeTech) return <Navigate to="/login" replace />
  return children
}
