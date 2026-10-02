import Icon from './Icon'

/* Buttons.
   One filled button per immediate action group. Never two dominant actions
   side by side — if you think you need two, one of them is a text button. */

export function Button({
  variant = 'filled',
  size,
  loading = false,
  disabled,
  fullWidth,
  icon,
  iconAfter,
  children,
  className = '',
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size === 'sm' && 'btn--sm',
    fullWidth && 'btn--full',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="btn__spinner" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
      {!loading && iconAfter ? <Icon name={iconAfter} size={18} /> : null}
    </button>
  )
}

export function IconButton({ icon, label, variant, disabled, className = '', ...rest }) {
  const classes = ['icon-btn', variant && `icon-btn--${variant}`, className].filter(Boolean).join(' ')
  return (
    <button className={classes} aria-label={label} disabled={disabled} {...rest}>
      <Icon name={icon} size={24} />
    </button>
  )
}

/* FAB — for the one dominant, frequent action strongly bound to a screen.
   Never for minor, destructive, or ambiguous actions. */
export function Fab({ icon = 'plus', label, disabled, className = '', ...rest }) {
  const extended = Boolean(label)
  const classes = ['fab', extended && 'fab--extended', className].filter(Boolean).join(' ')
  return (
    <button className={classes} disabled={disabled} {...rest}>
      <Icon name={icon} size={24} />
      {extended ? <span>{label}</span> : null}
    </button>
  )
}