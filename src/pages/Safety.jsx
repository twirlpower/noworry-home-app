import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCircle } from '../context/CircleContext'
import { SAFETY_ITEMS, SAFETY_GROUPS as GROUPS } from '../lib/safetyItems'

const EDIT_ROLES = ['home_owner', 'circle_manager', 'care_partner']

export default function Safety() {
  const { person } = useAuth()
  const { activeCircle, membership } = useCircle()
  const canEdit = EDIT_ROLES.includes(membership?.role)

  const [homeId, setHomeId] = useState(null)
  const [checked, setChecked] = useState({}) // item_key -> bool
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeCircle) return
    let cancelled = false
    supabase
      .from('circle_homes')
      .select('home_id')
      .eq('circle_id', activeCircle.id)
      .eq('status', 'active')
      .order('is_primary', { ascending: false })
      .then(({ data: ch }) => {
        if (cancelled) return
        const hid = ch?.[0]?.home_id ?? null
        setHomeId(hid)
        if (!hid) {
          setLoading(false)
          return
        }
        supabase
          .from('safety_checklist')
          .select('item_key, is_complete')
          .eq('home_id', hid)
          .then(({ data, error: e }) => {
            if (cancelled) return
            if (e) {
              const missing = /relation .* does not exist|PGRST205|schema cache/i.test(e.message)
              setError(
                missing
                  ? 'Safety checklist storage is not deployed yet — run migrations/005_safety_checklist.sql in Supabase.'
                  : e.message
              )
            } else {
              const map = {}
              for (const r of data ?? []) map[r.item_key] = r.is_complete
              setChecked(map)
            }
            setLoading(false)
          })
      })
    return () => {
      cancelled = true
    }
  }, [activeCircle])

  const total = SAFETY_ITEMS.length
  const done = SAFETY_ITEMS.filter((i) => checked[i.key]).length
  const pct = Math.round((done / total) * 100)
  const tone = pct >= 80 ? 'good' : pct >= 50 ? 'fair' : 'poor'

  async function toggle(item) {
    if (!canEdit || !homeId) return
    const next = !checked[item.key]
    setChecked((c) => ({ ...c, [item.key]: next })) // optimistic

    const { error: upErr } = await supabase.from('safety_checklist').upsert(
      {
        home_id: homeId,
        circle_id: activeCircle.id,
        item_key: item.key,
        is_complete: next,
        completed_by: person?.id ?? null,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'home_id,item_key' }
    )

    if (upErr) {
      setChecked((c) => ({ ...c, [item.key]: !next })) // revert
      const missing = /relation .* does not exist|PGRST205|schema cache/i.test(upErr.message)
      setError(
        missing
          ? 'Safety checklist storage is not deployed yet — run migrations/005_safety_checklist.sql in Supabase.'
          : upErr.message
      )
    }
  }

  if (!activeCircle) {
    return (
      <div className="page">
        <h1>Safety Checklist</h1>
        <p className="page-placeholder">You don't have a Home Circle yet.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p>Loading safety checklist…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Safety Checklist</h1>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="profile-card">
        <div className="safety-score">
          <span className={`safety-pct safety-${tone}`}>{pct}%</span>
          <span className="safety-count">{done} of {total} complete</span>
        </div>
        <div className="safety-bar">
          <div className={`safety-bar-fill safety-${tone}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {GROUPS.map((g) => (
        <div className="profile-card" key={g}>
          <h3>{g}</h3>
          <ul className="safety-list">
            {SAFETY_ITEMS.filter((i) => i.group === g).map((item) => (
              <li key={item.key} className="safety-item">
                <label className="safety-check">
                  <input
                    type="checkbox"
                    checked={!!checked[item.key]}
                    onChange={() => toggle(item)}
                    disabled={!canEdit}
                  />
                  <span>{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {!canEdit && (
        <p className="page-placeholder">
          You have view-only access to this checklist.
        </p>
      )}
    </div>
  )
}
