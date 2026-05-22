// POST /api/tech/generate-visit-report
// HomeTech-only. Given a visitId, builds a PDF report, uploads it to
// the visit-reports storage bucket, emails it to the home owner + all
// active circle members, and stamps home_visits.report_pdf_path and
// report_sent_at / report_sent_to.
//
// Single endpoint by design — splitting "build PDF" from "send email"
// would force the caller to handle the in-between state. With one
// route, the failure surface is: did the PDF reach the inbox or not?
//
// Auth: verifyHomeTech (same as the other tech routes).
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY, FROM_EMAIL  (optional — without them, PDF is still
//                                generated + uploaded but no email
//                                goes out; report_sent_to stays [])

import PDFDocument from 'pdfkit'
import { Resend } from 'resend'
import { serviceClient, verifyHomeTech } from '../admin/_staff-auth.mjs'

const CATEGORY_LABEL = {
  safety:     'Safety',
  hvac:       'HVAC',
  plumbing:   'Plumbing',
  exterior:   'Exterior / Seasonal',
  electrical: 'Electrical',
  tasks:      'Tasks Completed On Visit',
}
const CATEGORY_ORDER = ['safety', 'hvac', 'plumbing', 'exterior', 'electrical', 'tasks']

const SEVERITY_LABEL = {
  monitor:      'Monitor',
  address_soon: 'Address Soon',
  urgent:       'Urgent',
}

// Brand colors (RGB hex) used in the PDF.
const C_DEEP   = '#1B5E38'
const C_TEXT   = '#3D2E2A'
const C_MUTED  = '#7B6A66'
const C_AMBER  = '#A86A0E'
const C_RED    = '#B23A16'
const C_CARD   = '#F5F0EB'

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Build the PDF as a Buffer. pdfkit streams chunks; we accumulate
// them in memory since a single visit report is small (< 200KB).
function buildPdf(ctx) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 60 })
      const chunks = []
      doc.on('data', (c) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // ── Helpers
      const PAGE_W = doc.page.width
      const M = 60
      function footer() {
        const y = doc.page.height - 40
        doc.fontSize(8).fillColor(C_MUTED)
          .text(
            'NoWorry Home  |  noworry-home.com  |  (303) 555-0100  |  Confidential',
            M, y, { width: PAGE_W - 2 * M, align: 'center' }
          )
      }
      doc.on('pageAdded', footer)

      // ── Header (page 1)
      doc.fillColor(C_DEEP).fontSize(20).text('NoWorry Home', M, M)
      doc.fontSize(14).fillColor(C_TEXT).text('Home Care Visit Report', M, M + 28)

      let y = M + 70
      doc.fontSize(11).fillColor(C_TEXT)
        .text(`Member:`, M, y).font('Helvetica-Bold').text(ctx.memberName || '—', M + 80, y)
        .font('Helvetica')

      y += 18
      doc.text(`Address:`, M, y).font('Helvetica-Bold').text(ctx.address || '—', M + 80, y)
        .font('Helvetica')

      y += 18
      doc.text(`Visit date:`, M, y).font('Helvetica-Bold').text(fmtDate(ctx.visit.visit_date), M + 80, y)
        .font('Helvetica')

      y += 18
      doc.text(`Technician:`, M, y).font('Helvetica-Bold').text(ctx.visit.tech_name || '—', M + 80, y)
        .font('Helvetica')

      // ── Health score
      y += 32
      if (ctx.visit.health_score_before != null && ctx.visit.health_score_after != null) {
        doc.fontSize(12).fillColor(C_DEEP)
          .text(`Home Health Score: ${ctx.visit.health_score_before} → ${ctx.visit.health_score_after}`, M, y)
        y += 24
      }

      // ── Summary card
      doc.rect(M, y, PAGE_W - 2 * M, 80).fillColor(C_CARD).fill()
      doc.fillColor(C_DEEP).fontSize(11).text('Summary', M + 16, y + 14)
      doc.fillColor(C_TEXT).fontSize(11)
        .text(`✓ ${ctx.visit.items_checked || 0} items checked and clear`, M + 16, y + 30)
        .text(`⚠ ${ctx.visit.items_flagged || 0} items need attention`, M + 16, y + 46)
        .text(`✓ ${ctx.visit.items_completed || 0} tasks completed on the spot`, M + 16, y + 62)
      y += 100

      // ── Urgent findings box
      const urgents = (ctx.items || []).filter((i) => i.severity === 'urgent')
      if (urgents.length > 0) {
        const boxH = 24 + urgents.length * 16
        doc.rect(M, y, PAGE_W - 2 * M, boxH).fillColor('#FDE3DA').fill()
        doc.fillColor(C_RED).fontSize(11).text('Urgent — prompt attention needed', M + 16, y + 10)
        let ly = y + 28
        for (const it of urgents) {
          doc.fontSize(10).fillColor(C_TEXT)
            .text(`• ${it.item_title}${it.notes ? ` — ${it.notes}` : ''}`, M + 16, ly, {
              width: PAGE_W - 2 * M - 32,
            })
          ly += 16
        }
        y += boxH + 16
      }

      // ── Detailed findings (page 2+)
      doc.addPage()
      doc.fontSize(16).fillColor(C_DEEP).text('Detailed Findings', M, M)

      for (const cat of CATEGORY_ORDER) {
        const inCat = (ctx.items || []).filter((i) => i.item_category === cat)
        if (inCat.length === 0) continue

        if (doc.y > doc.page.height - 140) doc.addPage()
        doc.moveDown(1)
        doc.fontSize(13).fillColor(C_DEEP).text(CATEGORY_LABEL[cat] || cat)
        doc.moveDown(0.4)

        for (const it of inCat) {
          if (it.result === 'done') {
            doc.fontSize(10).fillColor(C_DEEP).text(`✓  ${it.item_title}`)
          } else if (it.result === 'needs_attention') {
            doc.fontSize(11).fillColor(C_AMBER).text(`⚠  ${it.item_title}`)
            const meta = []
            if (it.severity) meta.push(SEVERITY_LABEL[it.severity] || it.severity)
            if (meta.length) {
              doc.fontSize(9).fillColor(C_MUTED).text(`   ${meta.join(' · ')}`)
            }
            if (it.notes) {
              doc.fontSize(10).fillColor(C_TEXT).text(`   ${it.notes}`, { width: PAGE_W - 2 * M - 12 })
            }
            if (it.photo_path) {
              doc.fontSize(9).fillColor(C_MUTED).text(`   Photo available in app`)
            }
          }
          doc.moveDown(0.25)
        }

        // N/A items at the end of the category, gray.
        const naItems = inCat.filter((i) => i.result === 'not_applicable')
        if (naItems.length > 0) {
          doc.moveDown(0.3)
          doc.fontSize(9).fillColor(C_MUTED).text(`N/A: ${naItems.map((i) => i.item_title).join('; ')}`)
        }
      }

      // ── Tasks completed on the spot
      const completedItems = (ctx.items || []).filter((i) => i.completed_on_visit)
      if (completedItems.length > 0) {
        if (doc.y > doc.page.height - 120) doc.addPage()
        doc.moveDown(1)
        doc.fontSize(13).fillColor(C_DEEP).text('Tasks Completed On Visit')
        doc.moveDown(0.3)
        for (const it of completedItems) {
          doc.fontSize(10).fillColor(C_DEEP).text(`✓  ${it.item_title}`)
        }
      }

      footer()
      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}

// Personalize the email subject by the recipient's role in the circle.
// home_owner gets first-person; everyone else gets "{Owner}'s home".
function buildSubject(role, ownerFirstName) {
  const monthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  if (role === 'home_owner') return `Your home visit summary — ${monthYear}`
  return `${ownerFirstName || 'Your family member'}'s home visit — ${monthYear}`
}

function buildBody({ recipientFirstName, techName, address, visit, urgentTitle, anyFlagged }) {
  const lines = [
    `Hi ${recipientFirstName || 'there'},`,
    '',
    `${techName || 'Your NoWorry Home tech'} completed a Home Care Visit at ${address || 'your home'} on ${fmtDate(visit.visit_date)}.`,
    '',
    'Quick summary:',
    `- ${visit.items_checked || 0} items checked — all clear`,
    `- ${visit.items_flagged || 0} items noted for attention`,
    `- ${visit.items_completed || 0} tasks completed on the spot`,
  ]
  if (urgentTitle) {
    lines.push('', 'One item needs prompt attention:', `${urgentTitle}`)
  }
  lines.push('', 'Your full visit report is attached. You can also view it anytime in the NoWorry Home app.')
  if (anyFlagged) {
    lines.push('', "We'll be in touch about next steps on any flagged items.")
  }
  lines.push('', 'Take care,', 'The NoWorry Home Team', 'tye@noworry-home.com | (303) 555-0100')
  return lines.join('\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabase = serviceClient()
  if (!supabase) return res.status(500).json({ error: 'supabase_env_missing' })

  const verify = await verifyHomeTech(req, supabase)
  if (!verify.ok) return res.status(verify.status).json(verify.body)

  const { visitId } = req.body ?? {}
  if (!visitId) return res.status(400).json({ error: 'missing_visit_id' })

  // ── Fetch visit + items + home + member context.
  const { data: visit, error: vErr } = await supabase
    .from('home_visits')
    .select('*')
    .eq('id', visitId)
    .maybeSingle()
  if (vErr || !visit) return res.status(404).json({ error: 'visit_not_found' })

  const { data: items } = await supabase
    .from('visit_checklist_items')
    .select('*')
    .eq('visit_id', visitId)

  const { data: home } = await supabase
    .from('homes')
    .select('address_line1, address_line2, city, state, zip')
    .eq('id', visit.home_id)
    .maybeSingle()

  // Active circle members → emails + roles. home_owner first so subject
  // personalization can pull their first name.
  const { data: members } = await supabase
    .from('circle_memberships')
    .select('role, persons(first_name, last_name, email, auth_id)')
    .eq('circle_id', visit.circle_id)
    .eq('status', 'active')

  const memberRows = (members ?? [])
    .map((m) => ({
      role: m.role,
      first_name: m.persons?.first_name ?? null,
      last_name:  m.persons?.last_name  ?? null,
      email:      m.persons?.email      ?? null,
    }))
    .filter((m) => m.email)

  const owner = memberRows.find((m) => m.role === 'home_owner')
  const ownerFirstName = owner?.first_name ?? null
  const address = [
    home?.address_line1, home?.city && `${home.city},`, home?.state, home?.zip,
  ].filter(Boolean).join(' ')

  // ── Build PDF
  let pdfBuffer
  try {
    pdfBuffer = await buildPdf({
      visit, items: items ?? [], memberName: ownerFirstName ? `${ownerFirstName} ${owner.last_name ?? ''}`.trim() : '',
      address,
    })
  } catch (e) {
    console.error('[tech/generate-visit-report] PDF build failed', e?.message)
    return res.status(500).json({ error: 'pdf_failed', detail: e?.message })
  }

  // ── Upload PDF to storage
  const reportPath = `${visit.home_id}/${visit.visit_date}-${visit.id}.pdf`
  const { error: upErr } = await supabase.storage
    .from('visit-reports')
    .upload(reportPath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
  if (upErr) {
    console.error('[tech/generate-visit-report] storage upload failed', upErr.message)
    return res.status(500).json({ error: 'storage_upload_failed', detail: upErr.message })
  }

  // ── Send email (best-effort — failure logs but doesn't 500 the route).
  const recipientEmails = []
  if (process.env.RESEND_API_KEY && process.env.FROM_EMAIL && memberRows.length > 0) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const attachmentB64 = pdfBuffer.toString('base64')
    const urgent = (items ?? []).find((i) => i.severity === 'urgent')
    const anyFlagged = (items ?? []).some((i) => i.result === 'needs_attention')

    for (const m of memberRows) {
      try {
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to:   m.email,
          subject: buildSubject(m.role, ownerFirstName),
          text: buildBody({
            recipientFirstName: m.first_name,
            techName:           visit.tech_name,
            address,
            visit,
            urgentTitle:        urgent ? `${urgent.item_title} — ${SEVERITY_LABEL[urgent.severity] || urgent.severity}` : null,
            anyFlagged,
          }),
          attachments: [{
            filename: `home-visit-${visit.visit_date}.pdf`,
            content:  attachmentB64,
          }],
        })
        recipientEmails.push(m.email)
      } catch (e) {
        console.warn('[tech/generate-visit-report] email failed for', m.email, e?.message)
      }
    }
  }

  // ── Stamp the visit row + adjust homes.health_score.
  const stampedAt = new Date().toISOString()
  await supabase
    .from('home_visits')
    .update({
      status:          'complete',
      report_pdf_path: reportPath,
      report_sent_at:  recipientEmails.length > 0 ? stampedAt : null,
      report_sent_to:  recipientEmails,
    })
    .eq('id', visit.id)

  if (visit.health_score_after != null) {
    await supabase.from('homes')
      .update({ health_score: visit.health_score_after })
      .eq('id', visit.home_id)
  }

  return res.status(200).json({
    ok: true,
    reportPath,
    recipientCount: recipientEmails.length,
  })
}
