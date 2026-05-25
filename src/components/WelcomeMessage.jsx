import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'

// First-open overlay for a homeowner whose Path B circle_manager wrote
// them a welcome message during onboarding. Mounted by the homeowner
// dashboard so it only fires on the page the message is about.
//
// Lifecycle:
//   * On mount, query circle_welcome_messages for the one unshown row
//     targeting the current person in the active circle.
//   * If found, render a full-screen overlay with the note.
//   * On dismiss, set shown_at = now() so subsequent visits skip it.
//
// Per-row UNIQUE(circle_id, to_person_id) means the homeowner only
// ever sees one note per circle — re-running onboarding never produces
// a duplicate.
export default function WelcomeMessage() {
  const { person } = useAuth()
  const { activeCircle } = useCircle()
  const circleId = activeCircle?.id ?? null

  const [message, setMessage] = useState(null)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    if (!person?.id || !circleId) return
    let cancelled = false
    supabase
      .from('circle_welcome_messages')
      .select('id, message, sender:persons!from_person_id (first_name)')
      .eq('circle_id', circleId)
      .eq('to_person_id', person.id)
      .is('shown_at', null)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data?.message) setMessage(data)
      })
    return () => { cancelled = true }
  }, [person?.id, circleId])

  async function dismiss() {
    if (!message || dismissing) return
    setDismissing(true)
    const id = message.id
    // Hide immediately — the DB update is a best-effort follow-up.
    // If it fails the overlay will reappear next visit; that's a
    // gentler failure than leaving the screen hung on a network blip.
    setMessage(null)
    try {
      await supabase
        .from('circle_welcome_messages')
        .update({ shown_at: new Date().toISOString() })
        .eq('id', id)
    } catch {
      /* ignore — see comment above */
    }
  }

  if (!message) return null

  const senderName = message.sender?.first_name || 'Your family'

  return (
    <div className="welcome-message-overlay" role="dialog" aria-labelledby="welcome-message-heading">
      <div className="welcome-message-card">
        <div className="welcome-message-icon" aria-hidden="true">🏡</div>
        <p className="welcome-message-eyebrow" id="welcome-message-heading">
          A note from {senderName}
        </p>
        <p className="welcome-message-body">
          {message.message}
        </p>
        <button
          type="button"
          className="welcome-message-cta"
          onClick={dismiss}
          disabled={dismissing}
        >
          Open my home →
        </button>
      </div>
    </div>
  )
}
