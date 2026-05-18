import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CircleProvider } from './context/CircleContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import HomeProfile from './pages/HomeProfile'

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

            {/* Protected: onboarding (no shell yet) */}
            <Route path="/onboarding" element={
              <ProtectedRoute><Onboarding /></ProtectedRoute>
            } />

            {/* Protected: app shell with nested routes */}
            <Route path="/" element={
              <ProtectedRoute><AppShell /></ProtectedRoute>
            }>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="home-profile" element={<HomeProfile />} />
              <Route path="maintenance" element={<Placeholder title="Maintenance Calendar" />} />
              <Route path="safety" element={<Placeholder title="Safety Checklist" />} />
              <Route path="circle" element={<Placeholder title="My Circle" />} />
              <Route path="settings" element={<Placeholder title="Settings" />} />
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </CircleProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

function Placeholder({ title }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="page-placeholder">This section is coming soon.</p>
    </div>
  )
}
