import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  SEASON_META,
  SEASON_ITEMS,
  currentSeason,
  quarterId,
  isDueSoon,
  loadCompletion,
  toggleItem,
} from '../lib/quarterlyChecklist'

// Collapsible seasonal checklist at the top of the Maintenance page.
// Drives the Prepared → Covered conversion via the footer CTA.
//
// State lives in localStorage (no Supabase table for v1). The quarter id
// is encoded as q-{season}-{year} so the list naturally resets each season.
export default function QuarterlyChecklist({ tier }) {
  const season = currentSeason()
  const qid = quarterId()
  const meta = SEASON_META[season]
  const items = SEASON_ITEMS[season]
  const dueSoon = isDueSoon()

  // Lazy initializers — localStorage is sync, no effect needed (avoids the
  // strict set-state-in-effect lint rule).
  const [completed, setCompleted] = useState(() => new Set(loadCompletion(qid)))
  const allDone = completed.size >= items.length
  const [open, setOpen] = useState(() => !allDone)

  function toggle(idx) {
    setCompleted((prev) => {
      const next = new Set(prev)
      const willComplete = !next.has(idx)
      if (willComplete) next.add(idx)
      else next.delete(idx)
      toggleItem(qid, idx, willComplete)
      return next
    })
  }

  // Aware: locked card — no checkboxes, upgrade CTA in place.
  if (tier === 'aware') {
    return (
      <section className="qc-card qc-locked" aria-label={meta.title}>
        <div className="qc-header">
          <span className="qc-icon" aria-hidden="true">{meta.icon}</span>
          <div className="qc-titles">
            <h2 className="qc-title">{meta.title}</h2>
            <span className="qc-due qc-due-soft">{meta.dueLabel}</span>
          </div>
        </div>
        <p className="qc-locked-body">
          Complete your seasonal checklist with a Prepared plan — keep your
          home on track every quarter with reminders, completion tracking,
          and your family in the loop.
        </p>
        <Link to="/dashboard" className="btn-primary-full">
          Unlock your checklist with Prepared →
        </Link>
      </section>
    )
  }

  const progressLabel = `${completed.size} of ${items.length} complete`
  const isCovered = tier === 'covered' || tier === 'complete'

  return (
    <section className={`qc-card ${allDone ? 'qc-done' : ''}`} aria-label={meta.title}>
      <button
        type="button"
        className="qc-header qc-header-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="qc-icon" aria-hidden="true">{meta.icon}</span>
        <div className="qc-titles">
          <h2 className="qc-title">{meta.title}</h2>
          <span className="qc-meta-row">
            <span className={`qc-due ${dueSoon ? 'qc-due-warn' : 'qc-due-soft'}`}>
              {meta.dueLabel}
            </span>
            <span className={`qc-progress ${allDone ? 'qc-progress-done' : ''}`}>
              {progressLabel}
            </span>
          </span>
        </div>
        <span className="qc-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="qc-body">
          <ul className="qc-list">
            {items.map((label, idx) => {
              const isDone = completed.has(idx)
              return (
                <li key={idx} className={`qc-item ${isDone ? 'qc-item-done' : ''}`}>
                  <label className="qc-item-label">
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => toggle(idx)}
                    />
                    <span>{label}</span>
                  </label>
                </li>
              )
            })}
          </ul>

          {/* Conversion footer — only meaningful for prepared tier. Covered
              and Complete users see reassurance instead. */}
          {isCovered ? (
            <div className="qc-reassure">
              <p>
                Your {season} maintenance is scheduled. Your technician will
                handle this during your next quarterly visit.
              </p>
            </div>
          ) : (
            <div className="qc-convert">
              <h3 className="qc-convert-heading">Rather have this done for you?</h3>
              <p className="qc-convert-body">
                Covered members get a vetted technician every quarter who
                handles all of this automatically — same person every visit,
                no scheduling required.
              </p>
              <ul className="qc-convert-proof">
                <li>✓ Same handyman every quarter</li>
                <li>✓ Includes filter swap, simple tasks, and a full findings report</li>
              </ul>
              <Link to="/upgrade" className="btn-primary-full qc-convert-cta">
                See What's Included in Covered →
              </Link>
              <p className="qc-convert-fine">Starting at $99/mo · Cancel anytime</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
