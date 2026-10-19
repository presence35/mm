import Icon from './Icon'

/* Chips — filter/select criteria only. Never a button, never navigation.
   The state is the fill plus `aria-pressed`: no tick, no glyph. A tick inside a
   chip is one more mark to read on a panel that is already a page of marks, and
   the label names the answer either way.

   `tone`, when passed, comes from the same statusMeta call that labels the
   chip, and paints it only once the chip is chosen — an unchosen chip that is
   already coloured reads as switched on. */
export function Chip({ icon, selected, onClick, disabled, tone, children, ...rest }) {
  return (
    <button
      className="chip"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      data-tone={tone ?? undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  )
}

export function ChipRow({ children, className = '' }) {
  return <div className={`chip-row ${className}`.trim()}>{children}</div>
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