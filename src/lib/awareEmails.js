// Aware → Prepared conversion drip — schedule + template generation. Pure
// functions, no I/O. Imported by api/cron/send-aware-emails.mjs (the Vercel
// cron) and safe to import from the client if a preview UI ever wants it.
//
// Day offsets: 1 / 7 / 14 / 30, keyed off family_circles.created_at.
//
// aware_emails_sent shape on family_circles (jsonb, migration 050):
//   { day_1: '2026-06-02T15:00:00Z', day_7: ..., day_14: ..., day_30: ... }
// Missing key = unsent.
//
// Conversion path: every CTA points at /settings (a route that works today),
// labeled "See Prepared plan". The body copy still frames the offer as a free
// 30-day trial — consistent with the dashboard upsell (src/lib/promptEngine.js
// priority 30) — since /settings surfaces the plan/billing options.

const DAY_MS = 86400000

export const EMAIL_KEYS = ['day_1', 'day_7', 'day_14', 'day_30']

const OFFSETS = {
  day_1: 1 * DAY_MS,
  day_7: 7 * DAY_MS,
  day_14: 14 * DAY_MS,
  day_30: 30 * DAY_MS,
}

const SUBJECTS = {
  day_1: 'Welcome to NoWorry Home',
  day_7: 'The one thing families wish they\'d set up sooner',
  day_14: 'What Prepared members have that Aware doesn\'t',
  day_30: 'Still thinking it over?',
}

const APP_URL = 'https://app.noworry-home.com'
const CTA_URL = `${APP_URL}/settings`
const CTA_LABEL = 'See Prepared plan →'

// NoWorry Home green for the Aware campaign CTA — intentionally distinct from
// the trial drip's button color (#3B6D11).
const CTA_GREEN = '#1D9E75'

// Keys whose offset has elapsed since createdAt and which haven't been sent
// yet. Bad input (null createdAt, unparseable date) returns [] so the caller
// can just skip.
export function dueEmailKeys(createdAt, awareEmailsSent = {}, now = Date.now()) {
  if (!createdAt) return []
  const startMs = new Date(createdAt).getTime()
  if (Number.isNaN(startMs)) return []
  const sent = awareEmailsSent ?? {}
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

// The CTA button — single shared style so all four emails match exactly.
function ctaButton() {
  return `<p style="margin: 24px 0;">
      <a href="${CTA_URL}" style="display: inline-block; background: ${CTA_GREEN}; color: #FFFFFF; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 700;">${CTA_LABEL}</a>
    </p>`
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
  NoWorry Home · You're getting this because you signed up for the free Aware plan.
</p>
</body></html>`
}

// ── Templates ───────────────────────────────────────────────────────────────

const BUILDERS = {
  // Day 1 — welcome + orient: what Aware gives you, what Prepared adds.
  day_1: ({ firstName }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Welcome to NoWorry Home, ${escapeHtml(firstName) || 'there'} 👋</h1>
    <p>Your home is now on NoWorry Home. With <strong>Aware</strong> (free), you can keep your home profile and systems in one place and get seasonal reminders.</p>
    <p><strong>Prepared</strong> adds the part families tell us matters most:</p>
    <ul>
      <li>A secure place for your <strong>will, power of attorney, and insurance</strong></li>
      <li><strong>Emergency contacts</strong> your family can reach in a pinch</li>
      <li><strong>Shared tasks</strong> so everyone can help</li>
    </ul>
    <p>You can try Prepared free for 30 days — then it's $12/month, and you can cancel anytime.</p>
    ${ctaButton()}
  `),

  // Day 7 — story hook: the thing families wish they'd set up sooner.
  day_7: ({ firstName }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Hi ${escapeHtml(firstName) || 'there'} — a quick story</h1>
    <p>When something happens — a fall, a hospital visit, a storm — the scramble is almost always the same: <em>where are the documents, and who do we call?</em></p>
    <p>The families who feel calm in that moment are the ones who put their will, POA, insurance, and emergency contacts somewhere their whole family could find them — <strong>before</strong> they needed it.</p>
    <p>That's exactly what Prepared is for. Setting it up takes about 15 minutes.</p>
    ${ctaButton()}
  `),

  // Day 14 — capability gap: what Prepared members do that Aware can't.
  day_14: ({ firstName }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">What Prepared adds, ${escapeHtml(firstName) || 'there'}</h1>
    <p>Aware keeps your home tracked — and that's a great start. Prepared members go one step further:</p>
    <ul>
      <li>They <strong>invite family</strong> into the circle so others can help</li>
      <li>They <strong>store the documents that matter</strong> where everyone can reach them</li>
      <li>They <strong>coordinate care and tasks together</strong>, instead of over scattered texts</li>
    </ul>
    <p>It's the difference between <em>your</em> home record and <em>your family's</em> shared plan.</p>
    ${ctaButton()}
  `),

  // Day 30 — soft last nudge: no pressure, reinforce value.
  day_30: ({ firstName }) => shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Still thinking it over, ${escapeHtml(firstName) || 'there'}?</h1>
    <p>No pressure — your free Aware plan isn't going anywhere, and everything you've added stays put.</p>
    <p>But if getting your family's documents, contacts, and plan in one place has been on your mind, Prepared is free to try for 30 days and takes about 15 minutes to set up.</p>
    <p>Whenever you're ready, we'll be here.</p>
    ${ctaButton()}
  `),
}
