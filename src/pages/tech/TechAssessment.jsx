import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { extractSystemInfo } from '../../lib/ocrSystemInfo'
import { submitAssessment } from '../../lib/techSync'

// ── Step + system type definitions ──────────────────────────────────────
const REQUIRED_SYSTEMS = [
  { type: 'furnace',          label: 'Furnace / Heating',     needsFilter: true  },
  { type: 'ac',               label: 'Air Conditioning',      needsFilter: true  },
  { type: 'water_heater',     label: 'Water Heater',          needsFilter: false },
  { type: 'electrical_panel', label: 'Electrical Panel',      needsFilter: false },
]

const OPTIONAL_SYSTEMS = [
  { type: 'washer',               label: 'Washer',               needsFilter: false },
  { type: 'dryer',                label: 'Dryer',                needsFilter: false },
  { type: 'refrigerator',         label: 'Refrigerator',         needsFilter: false },
  { type: 'dishwasher',           label: 'Dishwasher',           needsFilter: false },
  { type: 'sump_pump',            label: 'Sump Pump',            needsFilter: false },
  { type: 'sprinkler_controller', label: 'Sprinkler Controller', needsFilter: false },
]

const HAZARDS = [
  { type: 'smoke_detector_missing', label: 'Smoke detectors',
    desc: 'Present and functional in each bedroom and common area' },
  { type: 'co_detector_missing',    label: 'CO detectors',
    desc: 'Present and within 10 years of manufacture date' },
  { type: 'gfci_missing',           label: 'GFCI outlets',
    desc: 'Present in kitchen, bathrooms, garage, exterior' },
  { type: 'water_damage',           label: 'Water damage',
    desc: 'Visible water damage or staining' },
  { type: 'mold_visible',           label: 'Mold',
    desc: 'Visible mold' },
  { type: 'exposed_wiring',         label: 'Wiring',
    desc: 'Exposed or damaged wiring' },
  { type: 'missing_handrail',       label: 'Handrails',
    desc: 'Missing handrails on stairs' },
  { type: 'trip_hazard',            label: 'Trip hazards',
    desc: 'Rugs, thresholds, clutter in walkways' },
]

function emptySystem(systemMeta) {
  return {
    system_type: systemMeta.type,
    label: systemMeta.label,
    needsFilter: systemMeta.needsFilter,
    manufacturer:    '',
    model_number:    '',
    serial_number:   '',
    install_year:    '',
    location_notes:  '',
    condition_notes: '',
    filter_size:     '',
    assessment_method: 'manual',
    photo: null,        // Blob
    photoUrl: null,     // object URL for thumb (revoked on unmount)
    extractedFields: new Set(),
    skipped: false,
  }
}

function emptyHazard(meta) {
  return {
    hazard_type: meta.type,
    label: meta.label,
    desc: meta.desc,
    present: null, // null = not answered, true = present, false = clear
    notes: '',
    photo: null,
    photoUrl: null,
  }
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function TechAssessment() {
  const { circleId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [home, setHome] = useState({ stories: '', hvac_system_count: '', dryer_vent_exit: '' })
  const [homeRow, setHomeRow] = useState(null)
  const [memberName, setMemberName] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [loaded, setLoaded] = useState(false)

  const [systems, setSystems] = useState(() => REQUIRED_SYSTEMS.map(emptySystem))
  const [hazardState, setHazardState] = useState(() => HAZARDS.map(emptyHazard))

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState('')

  // Steps: 0 = overview, 1..N = systems, N+1 = hazards, N+2 = review
  const totalSteps = 1 + systems.length + 1 + 1

  // Initial load — fetch home + member for header context.
  useEffect(() => {
    let cancelled = false
    async function load() {
      // tech_list_homes already returns the row we need for header
      // context. Reuse it rather than a separate query.
      const { data, error } = await supabase.rpc('tech_list_homes', { p_market: 'aurora' })
      if (cancelled) return
      if (error) { setLoadErr(error.message); setLoaded(true); return }
      const match = (data ?? []).find((h) => h.circle_id === circleId)
      if (!match) { setLoadErr('Home not found in your list.'); setLoaded(true); return }
      // We need home_id for inserts — pull it from homes via circle_homes.
      const { data: chRow } = await supabase
        .from('circle_homes')
        .select('home_id, homes(stories, hvac_system_count, dryer_vent_exit)')
        .eq('circle_id', circleId)
        .eq('status', 'active')
        .eq('is_primary', true)
        .maybeSingle()
      if (cancelled) return
      if (!chRow?.home_id) { setLoadErr('No home is linked to this circle.'); setLoaded(true); return }
      setHomeRow({
        id: chRow.home_id,
        address_line1: match.address_line1,
        city: match.city,
        zip: match.zip,
      })
      setMemberName(match.member_name || '')
      // Prefill overview if previously answered.
      if (chRow.homes) {
        setHome({
          stories:           chRow.homes.stories ?? '',
          hvac_system_count: chRow.homes.hvac_system_count ?? '',
          dryer_vent_exit:   chRow.homes.dryer_vent_exit ?? '',
        })
      }
      setLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [circleId])

  // Revoke any object URLs on unmount to avoid leaking.
  useEffect(() => {
    return () => {
      for (const s of systems) { if (s.photoUrl) URL.revokeObjectURL(s.photoUrl) }
      for (const h of hazardState) { if (h.photoUrl) URL.revokeObjectURL(h.photoUrl) }
    }
  }, [systems, hazardState])

  function setSystemField(idx, field, value) {
    setSystems((prev) => {
      const next = prev.slice()
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  function addOptionalSystem(meta) {
    setSystems((prev) => [...prev, emptySystem(meta)])
  }

  async function handlePhotoCapture(idx, file) {
    if (!file) return
    const sys = systems[idx]
    const url = URL.createObjectURL(file)
    if (sys.photoUrl) URL.revokeObjectURL(sys.photoUrl)
    setSystemField(idx, 'photo', file)
    setSystemField(idx, 'photoUrl', url)

    setSystemField(idx, 'assessment_method', 'ocr')
    setSystemField(idx, 'extractedFields', new Set(['__loading__']))

    const extracted = await extractSystemInfo(file, sys.system_type)
    const populated = new Set()

    setSystems((prev) => {
      const next = prev.slice()
      const target = { ...next[idx] }
      for (const k of ['manufacturer', 'model_number', 'serial_number', 'install_year', 'filter_size']) {
        if (extracted[k] != null && extracted[k] !== '' && !target[k]) {
          target[k] = String(extracted[k])
          populated.add(k)
        }
      }
      target.assessment_method = populated.size > 0 ? 'ocr_verified' : 'manual'
      target.extractedFields = populated
      next[idx] = target
      return next
    })
  }

  function handleHazardPhoto(idx, file) {
    if (!file) return
    setHazardState((prev) => {
      const next = prev.slice()
      if (next[idx].photoUrl) URL.revokeObjectURL(next[idx].photoUrl)
      const url = URL.createObjectURL(file)
      next[idx] = { ...next[idx], photo: file, photoUrl: url }
      return next
    })
  }

  function setHazard(idx, patch) {
    setHazardState((prev) => {
      const next = prev.slice()
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }

  function next() {
    setStep((s) => Math.min(s + 1, totalSteps - 1))
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0))
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }
  function skipCurrentSystem() {
    const sysIdx = step - 1
    setSystems((prev) => {
      const n = prev.slice()
      n[sysIdx] = { ...n[sysIdx], skipped: true }
      return n
    })
    next()
  }

  async function handleSubmit() {
    setSubmitErr('')
    setSubmitting(true)
    const payload = {
      circleId,
      homeId: homeRow.id,
      userId: user?.id ?? null,
      home: {
        stories:           home.stories ? Number(home.stories) : null,
        hvac_system_count: home.hvac_system_count ? Number(home.hvac_system_count) : null,
        dryer_vent_exit:   home.dryer_vent_exit || null,
      },
      systems: systems
        .filter((s) => !s.skipped && (s.manufacturer || s.model_number || s.serial_number || s.install_year || s.photo))
        .map((s) => ({
          system_type:       s.system_type,
          manufacturer:      s.manufacturer || null,
          model_number:      s.model_number || null,
          serial_number:     s.serial_number || null,
          install_year:      s.install_year ? Number(s.install_year) : null,
          location_notes:    s.location_notes || null,
          condition_notes:   s.condition_notes || null,
          filter_size:       s.filter_size || null,
          assessment_method: s.assessment_method,
          photo:             s.photo,
        })),
      hazards: hazardState
        .filter((h) => h.present !== null)
        .map((h) => ({
          hazard_type: h.hazard_type,
          present:     !!h.present,
          notes:       h.notes || null,
          photo:       h.photo,
        })),
      queuedAt: new Date().toISOString(),
    }

    const result = await submitAssessment(payload)
    setSubmitting(false)
    if (result.mode === 'synced') {
      navigate(`/tech/homes/${circleId}`, {
        state: { flash: 'Assessment complete!' },
      })
    } else {
      // Queued — still navigate back, but let the user know.
      navigate(`/tech/homes/${circleId}`, {
        state: { flash: 'Saved offline — will sync when connected' },
      })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (!loaded) {
    return <div className="tech-page"><p className="tech-meta">Loading…</p></div>
  }
  if (loadErr) {
    return (
      <div className="tech-page">
        <p className="tech-meta">{loadErr}</p>
        <Link to="/tech/homes" className="tech-btn-secondary">← Back to Homes</Link>
      </div>
    )
  }

  const onOverview = step === 0
  const sysIdx = step - 1
  const onSystem = step >= 1 && step <= systems.length
  const onHazards = step === systems.length + 1
  const onReview = step === totalSteps - 1

  return (
    <div className="tech-page assess-page">
      <button type="button" className="tech-back-link" onClick={() => navigate(`/tech/homes/${circleId}`)}>
        ← Cancel
      </button>

      <h1 className="tech-h1">Welcome Home Assessment</h1>
      <p className="tech-subtle">
        {homeRow.address_line1}
        {memberName ? ` · ${memberName}` : ''}
      </p>

      <ol className="assess-stepper" aria-label="Progress">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <li
            key={i}
            className={`assess-stepper-dot ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}
            aria-current={i === step ? 'step' : undefined}
          />
        ))}
      </ol>

      {onOverview && (
        <OverviewStep
          home={home}
          setHome={setHome}
          onNext={next}
        />
      )}

      {onSystem && (
        <SystemStep
          system={systems[sysIdx]}
          systemIdx={sysIdx}
          totalSystems={systems.length}
          onField={(field, value) => setSystemField(sysIdx, field, value)}
          onPhoto={(file) => handlePhotoCapture(sysIdx, file)}
          onBack={back}
          onNext={next}
          onSkip={skipCurrentSystem}
        />
      )}

      {onHazards && (
        <HazardsStep
          hazards={hazardState}
          setHazard={setHazard}
          onPhoto={handleHazardPhoto}
          onBack={back}
          onNext={next}
        />
      )}

      {onReview && (
        <ReviewStep
          home={home}
          systems={systems}
          hazardState={hazardState}
          onBack={back}
          onSubmit={handleSubmit}
          submitting={submitting}
          submitErr={submitErr}
          onAddOptional={addOptionalSystem}
          presentOptionalTypes={new Set(systems.map((s) => s.system_type))}
          onGoToStep={setStep}
        />
      )}
    </div>
  )
}

// ── Sub-step components ──────────────────────────────────────────────────

function OverviewStep({ home, setHome, onNext }) {
  const canAdvance = home.stories && home.hvac_system_count && home.dryer_vent_exit
  return (
    <>
      <h2 className="tech-h2">Home overview</h2>

      <fieldset className="assess-radio-group">
        <legend>How many floors does this home have?</legend>
        {[['1', '1 story'], ['2', '2 stories'], ['3', '3 or more stories']].map(([v, l]) => (
          <label key={v} className={`assess-radio ${home.stories === v ? 'on' : ''}`}>
            <input
              type="radio"
              name="stories"
              value={v}
              checked={home.stories === v}
              onChange={() => setHome({ ...home, stories: v })}
            />
            <span>{l}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="assess-radio-group">
        <legend>How many heating/cooling systems does this home have?</legend>
        <p className="tech-meta" style={{ marginBottom: '0.7rem' }}>
          A furnace + AC counts as 1 system.
        </p>
        {[['1', '1 system'], ['2', '2 systems'], ['3', '3 or more systems']].map(([v, l]) => (
          <label key={v} className={`assess-radio ${home.hvac_system_count === v ? 'on' : ''}`}>
            <input
              type="radio"
              name="hvac_system_count"
              value={v}
              checked={home.hvac_system_count === v}
              onChange={() => setHome({ ...home, hvac_system_count: v })}
            />
            <span>{l}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="assess-radio-group">
        <legend>Where does the dryer vent exit the house?</legend>
        {[
          ['ground_wall',       'Ground floor or basement wall'],
          ['second_floor_wall', 'Second floor wall'],
          ['roof',              'Through the roof'],
          ['unknown',           'Not sure'],
        ].map(([v, l]) => (
          <label key={v} className={`assess-radio ${home.dryer_vent_exit === v ? 'on' : ''}`}>
            <input
              type="radio"
              name="dryer_vent_exit"
              value={v}
              checked={home.dryer_vent_exit === v}
              onChange={() => setHome({ ...home, dryer_vent_exit: v })}
            />
            <span>{l}</span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="tech-btn-primary"
        disabled={!canAdvance}
        onClick={onNext}
      >
        Continue →
      </button>
    </>
  )
}

function SystemStep({ system, systemIdx, totalSystems, onField, onPhoto, onBack, onNext, onSkip }) {
  const loadingOcr = system.extractedFields?.has('__loading__')
  const ocrApplied = !loadingOcr && system.extractedFields?.size > 0
  const isExtracted = (k) => !loadingOcr && system.extractedFields?.has(k)

  return (
    <>
      <h2 className="tech-h2">
        {system.label}
        <span className="tech-meta" style={{ fontWeight: 'normal', marginLeft: '0.5rem' }}>
          ({systemIdx + 1} of {totalSystems})
        </span>
      </h2>

      <label className="assess-photo-btn">
        📷 {system.photo ? 'Retake info card' : 'Scan Info Card'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => onPhoto(e.target.files?.[0])}
          hidden
        />
      </label>

      {loadingOcr && <p className="tech-meta">Reading info card…</p>}
      {ocrApplied && (
        <p className="assess-ocr-status" role="status">
          ✓ Info extracted — please verify
        </p>
      )}

      {system.photoUrl && (
        <img src={system.photoUrl} alt="Captured info card" className="assess-photo-thumb" />
      )}

      <Field label="Manufacturer" extracted={isExtracted('manufacturer')}>
        <input
          type="text"
          className="form-input"
          value={system.manufacturer}
          onChange={(e) => onField('manufacturer', e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Model Number" extracted={isExtracted('model_number')}>
        <input
          type="text"
          className="form-input"
          value={system.model_number}
          onChange={(e) => onField('model_number', e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Serial Number" extracted={isExtracted('serial_number')}>
        <input
          type="text"
          className="form-input"
          value={system.serial_number}
          onChange={(e) => onField('serial_number', e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Year Installed" extracted={isExtracted('install_year')}>
        <input
          type="number"
          min="1950"
          max="2026"
          className="form-input"
          value={system.install_year}
          onChange={(e) => onField('install_year', e.target.value)}
        />
      </Field>

      {system.needsFilter && (
        <Field label="Filter Size" extracted={isExtracted('filter_size')}>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. 16x20x1"
            value={system.filter_size}
            onChange={(e) => onField('filter_size', e.target.value)}
          />
        </Field>
      )}

      <Field label="Location Notes">
        <input
          type="text"
          className="form-input"
          placeholder="e.g. basement northwest corner"
          value={system.location_notes}
          onChange={(e) => onField('location_notes', e.target.value)}
        />
      </Field>

      <Field label="Condition Notes">
        <textarea
          className="form-input"
          rows={3}
          placeholder="Any visible issues or concerns"
          value={system.condition_notes}
          onChange={(e) => onField('condition_notes', e.target.value)}
        />
      </Field>

      <button type="button" className="tech-btn-primary" onClick={onNext}>
        Save &amp; Continue →
      </button>
      <button type="button" className="tech-btn-secondary" onClick={onBack}>
        ← Back
      </button>
      <button type="button" className="assess-skip" onClick={onSkip}>
        Skip — not installed
      </button>
    </>
  )
}

function Field({ label, children, extracted = false }) {
  return (
    <label className={`assess-field ${extracted ? 'assess-field-extracted' : ''}`}>
      <span className="assess-field-label">
        {label} {extracted && <span aria-hidden="true" className="assess-field-check">✓</span>}
      </span>
      {children}
    </label>
  )
}

function HazardsStep({ hazards, setHazard, onPhoto, onBack, onNext }) {
  return (
    <>
      <h2 className="tech-h2">Quick Safety Check</h2>
      <p className="tech-subtle">Note anything that needs attention.</p>

      {hazards.map((h, i) => (
        <div key={h.hazard_type} className="assess-hazard">
          <h3 className="assess-hazard-label">{h.label}</h3>
          <p className="tech-meta">{h.desc}</p>
          <div className="assess-hazard-buttons">
            <button
              type="button"
              className={`assess-hazard-btn ${h.present === false ? 'on-clear' : ''}`}
              onClick={() => setHazard(i, { present: false })}
            >
              ✓ Clear
            </button>
            <button
              type="button"
              className={`assess-hazard-btn ${h.present === true ? 'on-present' : ''}`}
              onClick={() => setHazard(i, { present: true })}
            >
              ⚠ Present
            </button>
          </div>
          {h.present === true && (
            <>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Notes"
                value={h.notes}
                onChange={(e) => setHazard(i, { notes: e.target.value })}
                style={{ marginTop: '0.6rem' }}
              />
              <label className="assess-photo-btn" style={{ marginTop: '0.5rem' }}>
                📷 {h.photo ? 'Retake photo' : 'Add photo'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => onPhoto(i, e.target.files?.[0])}
                  hidden
                />
              </label>
              {h.photoUrl && <img src={h.photoUrl} alt="" className="assess-photo-thumb" />}
            </>
          )}
        </div>
      ))}

      <button type="button" className="tech-btn-primary" onClick={onNext}>
        Continue to Review →
      </button>
      <button type="button" className="tech-btn-secondary" onClick={onBack}>
        ← Back
      </button>
    </>
  )
}

function ReviewStep({
  home, systems, hazardState, onBack, onSubmit, submitting, submitErr,
  onAddOptional, presentOptionalTypes, onGoToStep,
}) {
  const optionalToOffer = useMemo(
    () => OPTIONAL_SYSTEMS.filter((s) => !presentOptionalTypes.has(s.type)),
    [presentOptionalTypes]
  )

  const completedSystems = systems.filter((s) => !s.skipped && (s.manufacturer || s.model_number || s.install_year || s.photo))
  const skippedSystems = systems.filter((s) => s.skipped)
  const hazardsPresent = hazardState.filter((h) => h.present === true).length
  const hazardsClear   = hazardState.filter((h) => h.present === false).length

  return (
    <>
      <h2 className="tech-h2">Review &amp; Submit</h2>

      <ReviewBlock title="Home overview" onEdit={() => onGoToStep(0)}>
        <p>Floors: <strong>{home.stories}</strong></p>
        <p>HVAC systems: <strong>{home.hvac_system_count}</strong></p>
        <p>Dryer vent: <strong>{home.dryer_vent_exit}</strong></p>
      </ReviewBlock>

      <ReviewBlock title={`Systems (${completedSystems.length})`}>
        {completedSystems.length === 0 ? (
          <p className="tech-meta">No systems captured.</p>
        ) : (
          <ul className="assess-review-list">
            {completedSystems.map((s, i) => (
              <li key={`${s.system_type}-${i}`}>
                <strong>{s.label}</strong>{' '}
                {[s.manufacturer, s.model_number].filter(Boolean).join(' ') || <em className="tech-meta">no details</em>}
              </li>
            ))}
          </ul>
        )}
        {skippedSystems.length > 0 && (
          <p className="tech-meta">Skipped: {skippedSystems.map((s) => s.label).join(', ')}</p>
        )}
      </ReviewBlock>

      <ReviewBlock title="Hazards" onEdit={() => onGoToStep(systems.length + 1)}>
        <p>
          <strong>{hazardsClear}</strong> clear,{' '}
          <strong>{hazardsPresent}</strong> present
        </p>
      </ReviewBlock>

      {optionalToOffer.length > 0 && (
        <ReviewBlock title="Add another system?">
          <div className="assess-add-grid">
            {optionalToOffer.map((opt) => (
              <button
                key={opt.type}
                type="button"
                className="tech-btn-secondary"
                onClick={() => onAddOptional(opt)}
              >
                + {opt.label}
              </button>
            ))}
          </div>
        </ReviewBlock>
      )}

      {submitErr && <div className="tech-banner tech-banner-danger" role="alert">{submitErr}</div>}

      <button
        type="button"
        className="tech-btn-primary"
        onClick={onSubmit}
        disabled={submitting}
      >
        {submitting ? 'Saving…' : 'Complete Assessment'}
      </button>
      <button type="button" className="tech-btn-secondary" onClick={onBack} disabled={submitting}>
        ← Back
      </button>
    </>
  )
}

function ReviewBlock({ title, children, onEdit }) {
  return (
    <div className="assess-review-block">
      <div className="assess-review-head">
        <h3>{title}</h3>
        {onEdit && (
          <button type="button" className="assess-review-edit" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      {children}
    </div>
  )
}
