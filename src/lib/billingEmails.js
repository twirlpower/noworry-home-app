// One-shot billing-event email templates. Same shell + escape helpers as
// trialEmails.js — kept separate because these are event-driven (payment
// success, downgrade) rather than time-driven (trial drip).

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

function shell(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #513C3C; line-height: 1.55; max-width: 540px; margin: 0 auto; padding: 24px 16px; font-size: 16px;">
${content}
<hr style="border: none; border-top: 1px solid #D9E8ED; margin: 32px 0 16px;">
<p style="font-size: 13px; color: #6A5A52;">
  NoWorry Home · You're getting this because you have a Prepared subscription.
</p>
</body></html>`
}

// ── Payment confirmation (post-subscribe) ───────────────────────────────────

export function paymentConfirmationSubject() {
  return 'Welcome to Prepared — your subscription is active'
}

export function paymentConfirmationHtml({ firstName, circleName, cardBrand, cardLast4, periodEndIso }) {
  const cardLine = cardBrand && cardLast4
    ? `${escapeHtml(String(cardBrand))} ending in ${escapeHtml(String(cardLast4))}`
    : null
  const nextDate = formatHumanDate(periodEndIso)
  return shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Welcome to Prepared, ${escapeHtml(firstName) || 'there'} 🎉</h1>
    <p>Your subscription on <strong>${escapeHtml(circleName) || 'your circle'}</strong> is active. Everything you built during your trial is right where you left it.</p>
    ${cardLine ? `<p style="font-size: 14px; color: #6A5A52;">Card on file: ${cardLine}.</p>` : ''}
    ${nextDate ? `<p style="font-size: 14px; color: #6A5A52;">Next billing date: ${escapeHtml(nextDate)}.</p>` : ''}
    <p>You can update your payment method or cancel anytime from Settings → Billing. We bill $12/month and never surprise you.</p>
    <p>Thank you for trusting us with your family's home.</p>
  `)
}

// ── Downgrade to Aware (warm, no hard sell) ─────────────────────────────────

export function downgradeSubject() {
  return "You're on the free Aware plan — your data is safe"
}

export function downgradeHtml({ firstName, circleName }) {
  return shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">We'll be here, ${escapeHtml(firstName) || 'there'}</h1>
    <p><strong>${escapeHtml(circleName) || 'Your circle'}</strong> is now on the free Aware plan. Your home record stays in place — we kept your documents, contacts, and tasks exactly as you left them.</p>
    <p>You can upgrade back to Prepared anytime from your dashboard. No re-entering anything — everything is still there.</p>
    <p>If something didn't work for you, hit reply on this email and tell us. We read every message.</p>
  `)
}

// ── Payment failed (card declined — warm, no urgency panic) ─────────────────

export function paymentFailedSubject() {
  return "Action needed — your NoWorry Home payment didn't go through"
}

export function paymentFailedHtml({ firstName, circleName }) {
  return shell(`
    <h1 style="color: #0A4A30; font-size: 22px; margin: 0 0 12px;">Let's get your payment sorted, ${escapeHtml(firstName) || 'there'}</h1>
    <p>We tried to process the payment for <strong>${escapeHtml(circleName) || 'your circle'}</strong>, but your card was declined. It happens — an expired card or a quick hold from your bank is usually all it is.</p>
    <p>Your home profile is completely safe. Nothing has changed, and you have time to update your payment method.</p>
    <p><a href="https://app.noworry-home.com/settings" style="color: #0A4A30; font-weight: 600;">Update your payment method →</a></p>
    <p>Once your card goes through, you're all set — there's nothing else you need to do.</p>
    <p>The NoWorry Home Team</p>
  `)
}
