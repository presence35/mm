import Icon from './Icon'

/* Chips — filter/select criteria only. Never a button, never navigation.
   Selected state shows a leading check as well as the fill, so selection
   survives greyscale. */
export function Chip({ icon, selected, onClick, disabled, children, ...rest }) {
  return (
    <button
      className="chip"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {selected ? <Icon name="check" size={16} className="chip__check" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  )
}

export function ChipRow({ children }) {
  return <div className="chip-row">{children}</div>
}

/* Segmented button — 2–5 mutually exclusive options that fit on screen. */
export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          className="segmented__item"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}