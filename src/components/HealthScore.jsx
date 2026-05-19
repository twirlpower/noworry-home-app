// Traffic-light home health widget. Presentational — takes a precomputed
// health object from computeHomeHealth() so callers control data fetching.

const TONE_LABEL = { good: 'Good', fair: 'Fair', poor: 'Needs attention' }

export default function HealthScore({ health, compact = false }) {
  if (!health) return null
  const { score, tone, factors } = health

  return (
    <div className={`health-widget health-${tone}`}>
      <div className="health-top">
        <span className="health-number">{score}</span>
        <div className="health-label-block">
          <span className={`health-score health-${tone}`}>{TONE_LABEL[tone]}</span>
          <span className="health-sub">Home health score</span>
        </div>
      </div>
      {!compact && (
        <ul className="health-factors">
          {factors.map((f) => (
            <li key={f.label} className="health-factor">
              <span className={`health-dot health-dot-${f.status}`} />
              <span className="health-factor-label">{f.label}</span>
              <span className="health-factor-detail">{f.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
