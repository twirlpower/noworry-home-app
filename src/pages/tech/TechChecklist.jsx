import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useHomeTechRole } from '../../hooks/useHomeTechRole'
import {
  CHECKLIST_VERSION, CHECKLIST_ITEMS, CATEGORY_LABELS, CATEGORY_ORDER,
  SEVERITY_OPTIONS, SEVERITY_POINTS, VISIT_BASE_POINTS,
} from '../../lib/techChecklistTemplate'
import { submitChecklistVisit } from '../../lib/techSync'

function emptyItemState(meta) {
  return {
    ...meta,
    result: 'pending',
    severity: null,
    notes: '',
    photo: null,
    photoUrl: null,
    confirmed: false, // for completed_on_visit items
  }
}

function calcDelta(items) {
  let delta = VISIT_BASE_POINTS
  for (const it of items) {
    if (it.result === 'needs_attention' && it.severity) {
      delta += SEVERITY_POINTS[it.severity] ?? 0
    }
  }
  return delta
}

function clampScore(n) {
  if (n == null || isNaN(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

export default function TechChecklist() {
  const { circleId } = useParams()
  const { user } = useAuth()
  const { homeTechData } = useHomeTechRole()
  const navigate = useNavigate()

  const [items, setItems] = useState(() => CHECKLIST_ITEMS.map(emptyItemState))
  const [homeRow, setHomeRow] = useState(null)
  const [memberName, setMemberName] = useState('')
  const [filterSize, setFilterSize] = useState('')
  const [healthScoreBefore, setHealthScoreBefore] = useState(null)
  const [visitsThisYear, setVisitsThisYear] = useState(0)
  const [loadErr, setLoadErr] = useState('')
  const [loaded, setLoaded] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)

  // Load home + member + filter size + visit-of-year count.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: ch } = await supabase
        .from('circle_homes')
        .select('home_id, homes(address_line1, city, zip, health_score)')
        .eq('circle_id', circleId)
        .eq('status', 'active')
        .eq('is_primary', true)
        .maybeSingle()
      if (cancelled) return
      if (!ch?.home_id) { setLoadErr('No home linked to this circle.'); setLoaded(true); return }

      setHomeRow({ id: ch.home_id, ...ch.homes })
      setHealthScoreBefore(ch.homes?.health_score ?? 100)

      // Member name + filter size + visit count run in parallel.
      const [memRes, sysRes, visRes] = await Promise.all([
        supabase
          .from('circle_memberships')
          .select('persons(first_name, last_name)')
          .eq('circle_id', circleId)
          .eq('role', 'home_owner')
          .eq('status', 'active')
          .limit(1)
          .maybeSingle(),
        supabase
          .from('home_systems')
          .select('system_type, filter_size')
          .eq('home_id', ch.home_id)
          .in('system_type', ['furnace', 'ac', 'hvac'])
          .not('filter_size', 'is', null)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('home_visits')
          .select('id', { count: 'exact', head: true })
          .eq('home_id', ch.home_id)
          .gte('visit_date', `${new Date().getFullYear()}-01-01`),
      ])
      if (cancelled) return

      const p = memRes?.data?.persons
      if (p) setMemberName([p.first_name, p.last_name].filter(Boolean).join(' '))
      if (sysRes?.data?.filter_size) setFilterSize(sysRes.data.filter_size)
      setVisitsThisYear(visRes?.count ?? 0)
      setLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [circleId])

  // Revoke photo object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const it of items) if (it.photoUrl) URL.revokeObjectURL(it.photoUrl)
    }
  }, [items])

  function patchItem(id, patch) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }
  function setPhoto(id, file) {
    if (!file) return
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it
      if (it.photoUrl) URL.revokeObjectURL(it.photoUrl)
      return { ...it, photo: file, photoUrl: URL.createObjectURL(file) }
    }))
  }

  const grouped = useMemo(() => {
    const map = {}
    for (const c of CATEGORY_ORDER) map[c] = []
    for (const it of items) {
      if (!map[it.category]) map[it.category] = []
      map[it.category].push(it)
    }
    return map
  }, [items])

  const progress = useMemo(() => {
    const total = items.length
    const done = items.filter((it) =>
      it.completed_on_visit ? it.confirmed : it.result !== 'pending'
    ).length
    return { done, total, pct: total > 0 ? (done / total) * 100 : 0 }
  }, [items])

  const flagged = items.filter((it) => it.result === 'needs_attention')
  const allAnswered = items.every((it) =>
    it.completed_on_visit
      ? it.confirmed
      : it.result !== 'pending' && (
          it.result !== 'needs_attention' || (it.severity && it.severity)
        )
  )

  async function handleSubmit() {
    if (!allAnswered || submitting) return
    setSubmitting(true)

    const itemsChecked = items.filter((it) => it.result === 'done' || it.confirmed).length
    const itemsFlagged = flagged.length
    const itemsCompleted = items.filter((it) => it.completed_on_visit && it.confirmed).length
    const scoreAfter = clampScore((healthScoreBefore ?? 100) + calcDelta(items))
    const visitNum = visitsThisYear + 1
    const quarterLabel = `Q${visitNum} ${new Date().getFullYear()}`

    const payload = {
      circleId,
      homeId: homeRow.id,
      userId: user?.id ?? null,
      techName: homeTechData?.name ?? null,
      visit: {
        visit_type:          'quarterly',
        visit_date:          new Date().toISOString().slice(0, 10),
        checklist_version:   CHECKLIST_VERSION,
        items_checked:       itemsChecked,
        items_flagged:       itemsFlagged,
        items_completed:     itemsCompleted,
        health_score_before: healthScoreBefore,
        health_score_after:  scoreAfter,
        notes:               null,
      },
      items: items.map((it) => ({
        item_title:         it.title,
        item_category:      it.category,
        result:             it.completed_on_visit
          ? (it.confirmed ? 'done' : 'not_applicable')
          : it.result,
        severity:           it.result === 'needs_attention' ? it.severity : null,
        notes:              it.notes || null,
        completed_on_visit: !!it.completed_on_visit && it.confirmed,
        photo:              it.photo,
      })),
      quarterLabel,
    }

    const result = await submitChecklistVisit(payload)
    setSubmitting(false)
    setSuccess({
      mode: result.mode,
      itemsChecked,
      itemsFlagged,
      quarterLabel,
      recipientCount: result.detail?.recipientCount ?? null,
    })
  }

  if (!loaded) {
    return <div className="tech-page"><p className="tech-meta">Loading…</p></div>
  }
  if (loadErr) {
    return (
      <div className="tech-page">
        <p className="tech-meta">{loadErr}</p>
        <Link to={`/tech/homes/${circleId}`} className="tech-btn-secondary">← Back</Link>
      </div>
    )
  }

  if (success) {
    return (
      <div className="tech-page">
        <h1 className="tech-h1">Visit Complete ✓</h1>
        <p className="tech-subtle">{success.quarterLabel}</p>
        <div className="tech-detail-block">
          <div className="tech-detail-row">
            <span className="tech-detail-label">Items checked</span>
            <strong>{success.itemsChecked}</strong>
          </div>
          <div className="tech-detail-row">
            <span className="tech-detail-label">Items flagged</span>
            <strong className={success.itemsFlagged > 0 ? 'task-due-overdue' : ''}>
              {success.itemsFlagged}
            </strong>
          </div>
        </div>
        {success.mode === 'synced' && (
          <p className="tech-meta">
            Report sent to {memberName || 'the homeowner'}
            {success.recipientCount > 1 && ` and ${success.recipientCount - 1} family member${success.recipientCount === 2 ? '' : 's'}`}.
          </p>
        )}
        {success.mode === 'queued' && (
          <p className="tech-meta">
            Saved offline — report will be sent when connected.
          </p>
        )}
        <Link to={`/tech/homes/${circleId}`} className="tech-btn-primary">
          Back to Home
        </Link>
        <Link to="/tech/homes" className="tech-btn-secondary">
          ← Back to Homes
        </Link>
      </div>
    )
  }

  const visitNum = visitsThisYear + 1
  const quarterLabel = `Q${visitNum} ${new Date().getFullYear()}`
  const todayLabel = new Date().toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="tech-page checklist-page">
      <button type="button" className="tech-back-link" onClick={() => navigate(`/tech/homes/${circleId}`)}>
        ← Cancel
      </button>

      <h1 className="tech-h1">{homeRow?.address_line1 || 'Home'}</h1>
      <p className="tech-subtle">
        {memberName || 'Member'} · Quarterly Home Care Visit
      </p>
      <p className="tech-meta">{todayLabel} · {quarterLabel}</p>

      <div className="check-progress" role="status" aria-live="polite">
        <div className="check-progress-bar">
          <div className="check-progress-fill" style={{ width: `${progress.pct}%` }} />
        </div>
        <span className="check-progress-text">
          {progress.done} of {progress.total} items completed
        </span>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const list = grouped[cat] || []
        if (list.length === 0) return null
        return (
          <section key={cat} className="check-category">
            <h2 className="check-category-head">{CATEGORY_LABELS[cat] ?? cat}</h2>
            {list.map((it) => (
              <ChecklistRow
                key={it.id}
                item={it}
                filterSize={it.showsFilterSize ? filterSize : ''}
                onResult={(result) => patchItem(it.id, { result, severity: null })}
                onConfirm={() => patchItem(it.id, { confirmed: !it.confirmed })}
                onSeverity={(severity) => patchItem(it.id, { severity })}
                onNotes={(notes) => patchItem(it.id, { notes })}
                onPhoto={(f) => setPhoto(it.id, f)}
              />
            ))}
          </section>
        )
      })}

      <div className="check-floating-bar">
        {flagged.length > 0 && (
          <span className="check-flagged-count">
            {flagged.length} item{flagged.length === 1 ? '' : 's'} need attention
          </span>
        )}
        <button
          type="button"
          className="tech-btn-primary"
          disabled={!allAnswered || submitting}
          onClick={handleSubmit}
        >
          {submitting ? 'Saving…' : 'Complete Visit'}
        </button>
      </div>
    </div>
  )
}

function ChecklistRow({ item, filterSize, onResult, onConfirm, onSeverity, onNotes, onPhoto }) {
  if (item.completed_on_visit) {
    return (
      <div className={`check-item ${item.confirmed ? 'check-item-confirmed' : ''}`}>
        <div className="check-item-title">{item.title}</div>
        {filterSize && (
          <div className="check-item-filter">Filter size: <strong>{filterSize}</strong></div>
        )}
        <button
          type="button"
          className={`check-confirm-btn ${item.confirmed ? 'on' : ''}`}
          onClick={onConfirm}
        >
          {item.confirmed ? 'Completed on the spot ✓' : 'Tap when complete'}
        </button>
      </div>
    )
  }

  return (
    <div className={`check-item ${item.result === 'not_applicable' ? 'check-item-na' : ''}`}>
      <div className="check-item-title">{item.title}</div>
      {filterSize && (
        <div className="check-item-filter">Filter size: <strong>{filterSize}</strong></div>
      )}
      <div className="check-result-row">
        <button
          type="button"
          className={`check-result-btn ${item.result === 'done' ? 'on-done' : ''}`}
          onClick={() => onResult('done')}
        >
          ✓ Done
        </button>
        <button
          type="button"
          className={`check-result-btn ${item.result === 'needs_attention' ? 'on-warn' : ''}`}
          onClick={() => onResult('needs_attention')}
        >
          ⚠ Needs Attention
        </button>
        <button
          type="button"
          className={`check-result-btn ${item.result === 'not_applicable' ? 'on-na' : ''}`}
          onClick={() => onResult('not_applicable')}
        >
          N/A
        </button>
      </div>

      {item.result === 'needs_attention' && (
        <div className="check-attention">
          <div className="check-severity-row">
            {SEVERITY_OPTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`check-severity-btn ${item.severity === s.value ? `on-${s.value}` : ''}`}
                onClick={() => onSeverity(s.value)}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </div>
          <textarea
            className="form-input"
            rows={2}
            placeholder="Notes"
            value={item.notes}
            onChange={(e) => onNotes(e.target.value)}
          />
          <label className="assess-photo-btn" style={{ marginTop: '0.5rem' }}>
            📷 {item.photo ? 'Retake photo' : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onPhoto(e.target.files?.[0])}
              hidden
            />
          </label>
          {item.photoUrl && <img src={item.photoUrl} alt="" className="assess-photo-thumb" />}
        </div>
      )}
    </div>
  )
}
