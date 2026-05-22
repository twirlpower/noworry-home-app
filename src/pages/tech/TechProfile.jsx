import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useHomeTechRole } from '../../hooks/useHomeTechRole'
import { useStaffRole } from '../../hooks/useStaffRole'
import { useViewMode } from '../../context/ViewModeContext'

const BG_PILL = {
  pending: { tone: 'amber', label: 'Pending' },
  passed:  { tone: 'green', label: 'Passed' },
  failed:  { tone: 'red',   label: 'Failed' },
  expired: { tone: 'red',   label: 'Expired' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

function fmtPhone(p) {
  if (!p) return '—'
  const d = String(p).replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return p
}

export default function TechProfile() {
  const { signOut } = useAuth()
  const { homeTechData, loading } = useHomeTechRole()
  const { isStaff } = useStaffRole()
  const { setViewMode } = useViewMode()
  const navigate = useNavigate()

  if (loading) {
    return <div className="tech-page"><p className="tech-meta">Loading…</p></div>
  }
  if (!homeTechData) {
    // HomeTechRoute should have already bounced us, but defensive guard.
    return <div className="tech-page"><p className="tech-meta">No tech profile found.</p></div>
  }

  const bg = BG_PILL[homeTechData.background_check_status] ?? {
    tone: 'gray',
    label: homeTechData.background_check_status,
  }

  async function switchToAdmin() {
    setViewMode('admin')
    navigate('/admin/crm')
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="tech-page">
      <h1 className="tech-h1">Your Account</h1>

      <div className="tech-detail-block">
        <div className="tech-detail-row">
          <span className="tech-detail-label">Name</span>
          <span>{homeTechData.name}</span>
        </div>
        <div className="tech-detail-row">
          <span className="tech-detail-label">Email</span>
          <span>{homeTechData.email}</span>
        </div>
        <div className="tech-detail-row">
          <span className="tech-detail-label">Phone</span>
          <span>{fmtPhone(homeTechData.phone)}</span>
        </div>
        <div className="tech-detail-row">
          <span className="tech-detail-label">Background check</span>
          <span className={`tech-status-pill tech-status-${bg.tone}`}>{bg.label}</span>
        </div>
        {homeTechData.background_check_date && (
          <div className="tech-detail-row">
            <span className="tech-detail-label">Checked on</span>
            <span>{fmtDate(homeTechData.background_check_date)}</span>
          </div>
        )}
        <div className="tech-detail-row">
          <span className="tech-detail-label">Activation fee</span>
          <span className={`tech-status-pill tech-status-${homeTechData.activation_fee_paid ? 'green' : 'amber'}`}>
            {homeTechData.activation_fee_paid ? 'Paid' : 'Unpaid'}
          </span>
        </div>
        <div className="tech-detail-row">
          <span className="tech-detail-label">Primary market</span>
          <span>{homeTechData.primary_market || '—'}</span>
        </div>
        <div className="tech-detail-row">
          <span className="tech-detail-label">Member since</span>
          <span>{fmtDate(homeTechData.created_at)}</span>
        </div>
      </div>

      {isStaff && (
        <button type="button" className="tech-btn-secondary" onClick={switchToAdmin}>
          Switch to Admin View →
        </button>
      )}

      <button type="button" className="tech-btn-danger" onClick={handleSignOut}>
        Sign Out
      </button>
    </div>
  )
}
