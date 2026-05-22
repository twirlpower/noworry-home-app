import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CircleProvider } from './context/CircleContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import HomeProfile from './pages/HomeProfile'
import Maintenance from './pages/Maintenance'
import Safety from './pages/Safety'
import Circle from './pages/Circle'
import Tasks from './pages/Tasks'
import Documents from './pages/Documents'
import EmergencyContacts from './pages/EmergencyContacts'
import Settings from './pages/Settings'
import AdminCRM from './pages/admin/AdminCRM'
import AdminSettings from './pages/admin/AdminSettings'
import { useStaffRole } from './hooks/useStaffRole'
import { useCircle } from './context/CircleContext'

// Role-based admin gate. Non-staff bounce silently to /dashboard. While the
// role lookup is in flight we render nothing — better than flashing the
// dashboard or letting a member glimpse admin UI before the redirect fires.
function AdminRoute({ children, requireOwner = false }) {
  const { isStaff, isOwner, loading } = useStaffRole()
  if (loading) return null
  if (!isStaff) return <Navigate to="/dashboard" replace />
  if (requireOwner && !isOwner) return <Navigate to="/dashboard" replace />
  return children
}

// Index route. Three destinations:
//   * Staff (any role)             → /admin/crm
//   * Member with an active circle → /dashboard
//   * Member without a circle      → /onboarding
//
// Both useStaffRole and useCircle are async (Supabase lookups). Render
// nothing while either is still resolving — otherwise a member would
// flash through /dashboard before their staff role lookup resolves, or
// a staff account would briefly see the member onboarding screen.
function RootRedirect() {
  const { isStaff, loading: staffLoading } = useStaffRole()
  const { activeCircle, loading: circleLoading } = useCircle()

  // DEBUG: remove after staff routing is confirmed working.
  // eslint-disable-next-line no-console
  console.log('[RootRedirect]', {
    staffLoading,
    circleLoading,
    isStaff,
    activeCircleId: activeCircle?.id ?? null,
  })

  if (staffLoading || circleLoading) {
    // eslint-disable-next-line no-console
    console.log('[RootRedirect] waiting on loading flags → render null')
    return null
  }
  if (isStaff) {
    // eslint-disable-next-line no-console
    console.log('[RootRedirect] isStaff=true → navigate /admin/crm')
    return <Navigate to="/admin/crm" replace />
  }
  if (activeCircle) {
    // eslint-disable-next-line no-console
    console.log('[RootRedirect] member with circle → navigate /dashboard')
    return <Navigate to="/dashboard" replace />
  }
  // eslint-disable-next-line no-console
  console.log('[RootRedirect] member without circle → navigate /onboarding')
  return <Navigate to="/onboarding" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CircleProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Protected: onboarding (no shell yet) */}
            <Route path="/onboarding" element={
              <ProtectedRoute><Onboarding /></ProtectedRoute>
            } />

            {/* Protected: app shell with nested routes */}
            <Route path="/" element={
              <ProtectedRoute><AppShell /></ProtectedRoute>
            }>
              <Route index element={<RootRedirect />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="home-profile" element={<HomeProfile />} />
              <Route path="maintenance" element={<Maintenance />} />
              <Route path="safety" element={<Safety />} />
              <Route path="documents" element={<Documents />} />
              <Route path="emergency-contacts" element={<EmergencyContacts />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="circle" element={<Circle />} />
              <Route path="settings" element={<Settings />} />
              <Route path="admin/crm" element={
                <AdminRoute><AdminCRM /></AdminRoute>
              } />
              <Route path="admin/settings" element={
                <AdminRoute requireOwner><AdminSettings /></AdminRoute>
              } />
            </Route>

            {/* Placeholder redirects: PromptCard upsells and the quarterly
                checklist's Covered CTA link here. When Stripe-backed pages
                ship, swap the element to the real route. */}
            <Route path="/upgrade" element={<Navigate to="/dashboard" replace />} />
            <Route path="/trial-activation" element={<Navigate to="/dashboard" replace />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </CircleProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
