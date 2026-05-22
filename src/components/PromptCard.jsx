import { Link } from 'react-router-dom'

// Single-prompt dashboard nudge. Presentational only — Dashboard owns the
// engine evaluation and dismiss persistence; this component just renders.
// Animate-in is a one-shot CSS keyframe, no animation libraries.
export default function PromptCard({ prompt, onDismiss }) {
  if (!prompt) return null
  return (
    <div
      className={`prompt-card prompt-card-${prompt.type}`}
      role="region"
      aria-label={prompt.headline}
    >
      {prompt.dismissible && (
        <button
          type="button"
          className="prompt-card-dismiss"
          aria-label="Dismiss"
          onClick={() => onDismiss?.(prompt)}
        >
          ×
        </button>
      )}
      <h3 className="prompt-card-headline">{prompt.headline}</h3>
      <p className="prompt-card-body">{prompt.body}</p>
      <Link to={prompt.ctaPath} className="prompt-card-cta">
        {prompt.cta}
      </Link>
    </div>
  )
}
