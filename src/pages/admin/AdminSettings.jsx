import { useState } from 'react'
import StaffAccountsCard from '../../components/admin/StaffAccountsCard'

const NOTES_KEY = 'noworry-admin-founder-notes'

function loadNotes() {
  try {
    return localStorage.getItem(NOTES_KEY) || ''
  } catch {
    return ''
  }
}

export default function AdminSettings() {
  // localStorage is synchronous — lazy initial state keeps reads out of an
  // effect (avoids the react-hooks/set-state-in-effect rule).
  const [notes, setNotes] = useState(() => loadNotes())

  function saveNotes() {
    try {
      localStorage.setItem(NOTES_KEY, notes)
    } catch {
      // localStorage unavailable — fail silent
    }
  }

  return (
    <div className="page admin-page">
      <div className="admin-header">
        <h1>Admin Settings</h1>
        <p className="admin-subtitle">Owner view · Account and system settings</p>
      </div>

      {/* Staff Accounts — the route is owner-gated, so this card is
          implicitly owner-only. */}
      <StaffAccountsCard />

      {/* Quick Links */}
      <section className="admin-section">
        <h2>Quick Links</h2>
        <ul className="admin-link-list">
          <li>
            <a
              href="https://supabase.com/dashboard/project/hyqurxvuxhwjeqxchuuz"
              target="_blank"
              rel="noreferrer"
            >
              Supabase dashboard
            </a>
          </li>
          <li>
            <a
              href="https://vercel.com/dashboard"
              target="_blank"
              rel="noreferrer"
            >
              Vercel dashboard
            </a>
          </li>
          <li>
            <a
              href="https://github.com/twirlpower/noworry-home-app"
              target="_blank"
              rel="noreferrer"
            >
              GitHub repo
            </a>
          </li>
        </ul>
      </section>

      {/* Founder Notes */}
      <section className="admin-section">
        <h2>Founder Notes</h2>
        <p className="admin-meta admin-section-sub">
          Private notes — only you see this. Auto-saves on blur.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          className="form-input admin-notes"
          rows={8}
          placeholder="Anything you want to remember…"
        />
      </section>
    </div>
  )
}
