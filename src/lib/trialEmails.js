// Trial email drip — schedule + template generation. Pure functions, no I/O.
// Imported by api/cron/send-trial-emails.mjs (the Vercel cron) and also
// safe to import from the client (e.g. a future "trial schedule" UI).
//
// Day offsets per the Phase 2 Revenue Track spec: 1 / 7 / 14 / 28.
//
// trial_emails_sent shape on family_circles (jsonb, migration 012):
//   { day_1: '2026-05-21T14:00:00Z', day_7: ..., day_14: ..., day_28: ... }
// Missing key = unsent.

const DAY_MS = 86400000

export const EMAIL_KEYS = ['day_1', 'day_7', 'day_14', 'day_28', 'day_30']

const OFFSETS = {
  day_1: 1 * DAY_MS,
  day_7: 7 * DAY_MS,
  day_14: 14 * DAY_MS,
  day_28: 28 * DAY_MS,
  // day_30 fires AT trial end (and on every cron tick after, but trial_emails_sent
  // stamps it so the second invocation is a no-op).
  day_30: 30 * DAY_MS,
}

const SUBJECTS = {
  day_1: 'Welcome to Prepared',
  day_7: 'How\'s your Prepared trial going?',
  day_14: 'You\'re halfway through your Prepared trial',
  day_28: 'Your Prepared trial ends in 3 days',
  day_30: 'Your NoWorry Home trial has ended',
}

const APP_URL = 'https://app.noworry-home.com'

// Keys whose offset has elapsed since trialStartedAt and which haven't been
// sent yet. Bad input (null trialStartedAt, unparseable date) returns [] so
// the caller can just skip.
export function dueEmailKeys(trialStartedAt, trialEmailsSent = {}, now = Date.now()) {
  if (!trialStartedAt) return []
  const startMs = new Date(trialStartedAt).getTime()
  if (Number.isNaN(startMs)) return []
  const sent = trialEmailsSent ?? {}
  return EMAIL_KEYS.filter((k) => !sent[k] && now >= startMs + OFFSETS[k])
}

export function subjectFor(key) {
  return SUBJECTS[key] ?? ''
}

export function htmlFor(key, context = {}) {
  const builder = BUILDERS[key]
  return builder ? builder(context) : ''
}

// ── HTML helpers ────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]))
}

function formatHumanDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// Minimal email shell — inline styles only, plain enough to render in the
// senior-first audience's mail clients (often Outlook / older webmail).
function shell(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #513C3C; line-height: 1.55; max-width: 540px; margin: 0 auto; padding: 24px 16px; font-size: 16px;">
${content}
<hr style="border: none; border-top: 1px solid #D9E8ED; margin: 32px 0 16px;">
<p style="font-size: 13px; color: #6A5A52;">
  NoWorry Home · You're getting this because you started a Prepared trial.
</p>
</body></html>`
}

// ── Templates ───────────────────────────────────────────────────────────────

const BUILDERS = {
  day_1: ({ firstName, circleName }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Welcome to Prepared, ${escapeHtml(firstName) || 'there'} 👋</h1>
    <p>Your 30-day trial on <strong>${escapeHtml(circleName) || 'your circle'}</strong> is active. Nothing to install — your circle is already upgraded.</p>
    <p>Here's what most families do first:</p>
    <ul>
      <li>Add a few <a href="${APP_URL}/documents" style="color: #185FA5;">important documents</a> (will, POA, insurance)</li>
      <li>Set up <a href="${APP_URL}/circle" style="color: #185FA5;">family invites</a> so others can help</li>
      <li>Capture your <a href="${APP_URL}/tasks" style="color: #185FA5;">first shared tasks</a></li>
    </ul>
    <p>Most people get through the basics in about 15 minutes.</p>
  `),

  day_7: ({ firstName }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Hi ${escapeHtml(firstName) || 'there'} — how's it going?</h1>
    <p>One week into your Prepared trial. Here are the moves that tend to make the biggest difference:</p>
    <ol>
      <li><strong>Add your emergency contacts</strong> in priority order — takes 2 minutes.</li>
      <li><strong>Upload your will and POA</strong>, even if they're drafts. Having them in one place is the win.</li>
      <li><strong>Invite one family member</strong> — even just to see what they'd see.</li>
    </ol>
    <p><a href="${APP_URL}/dashboard" style="color: #185FA5;">Open your dashboard →</a></p>
  `),

  day_14: ({ firstName, trialEndsAt }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Halfway through, ${escapeHtml(firstName) || 'there'}</h1>
    <p>Your trial ends ${escapeHtml(formatHumanDate(trialEndsAt))}. That's still two weeks away — plenty of time.</p>
    <p>If anything's missing or unclear, hit reply on this email and we'll help.</p>
    <p><a href="${APP_URL}/dashboard" style="color: #185FA5;">Open your dashboard →</a></p>
  `),

  day_28: ({ firstName, trialEndsAt }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">${escapeHtml(firstName) || 'Heads up'} — 3 days left on your trial</h1>
    <p>Your Prepared trial ends ${escapeHtml(formatHumanDate(trialEndsAt))}. After that it's $12/mo — cancel anytime.</p>
    <p>To keep your family's documents, contacts, and shared tasks accessible without interruption:</p>
    <p>
      <a href="${APP_URL}/settings" style="display: inline-block; background: #3B6D11; color: #FFFFFF; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 700;">Add a payment method →</a>
    </p>
    <p>If you do nothing, your circle goes back to the free Aware tier on ${escapeHtml(formatHumanDate(trialEndsAt))}. Your data stays put — you just lose access to the Prepared features.</p>
  `),

  day_30: ({ firstName }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Your NoWorry Home trial has ended, ${escapeHtml(firstName) || 'there'}</h1>
    <p>Your 30-day trial is complete. Everything you've built is still here — your home profile, documents, and family plan are all saved.</p>
    <p>To keep access, add a payment method and continue with Prepared for $12/month.</p>
    <p>
      <a href="${APP_URL}/dashboard" style="display: inline-block; background: #3B6D11; color: #FFFFFF; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 700;">Continue with Prepared →</a>
    </p>
    <p>Or you can continue with the free Aware plan — your home record stays, and you can upgrade anytime.</p>
    <p>We're here either way.</p>
  `),
}
