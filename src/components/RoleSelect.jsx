import { INVITABLE_ROLES } from '../lib/circleRoles'

// Accessible descriptive role picker: a radio group of cards, each showing the
// role name + a one-line explanation. `name` must be unique per instance
// (multiple selectors render on the onboarding invite step).
export default function RoleSelect({ name, value, onChange, legend = 'Role' }) {
  return (
    <fieldset className="role-select">
      <legend className="role-select-legend">{legend}</legend>
      {INVITABLE_ROLES.map((r) => (
        <label
          key={r.key}
          className={`role-option ${value === r.key ? 'role-option-active' : ''}`}
        >
          <input
            type="radio"
            name={name}
            value={r.key}
            checked={value === r.key}
            onChange={() => onChange(r.key)}
          />
          <span className="role-option-text">
            <span className="role-option-label">{r.label}</span>
            <span className="role-option-desc">{r.desc}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
