import Icon from './Icon'

/* Checkbox — one decision made once per sign-in, so it exists on its own
 * rather than inside a form. Native input underneath: no synthesized
 * semantics. The whole row is the target, not the 40px square. */
export default function Checkbox({ checked, onChange, label, support }) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        className="checkbox__control"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="checkbox__box" aria-hidden="true">
        {checked ? <Icon name="check" size={16} /> : null}
      </span>
      <span className="checkbox__text">
        <span className="checkbox__label">{label}</span>
        {support ? <span className="checkbox__support">{support}</span> : null}
      </span>
    </label>
  )
}
