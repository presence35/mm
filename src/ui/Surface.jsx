import Icon from './Icon'

/* Cards — only where the content is genuinely a contained unit.
   Never used to fill empty space, never nested inside another card. */

export function Card({ variant = 'low', className = '', children, ...rest }) {
  const classes = ['card', `card--${variant}`, className].filter(Boolean).join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}

export function Divider({ className = '' }) {
  return <hr className={`divider ${className}`.trim()} />
}

/* `tone`, when passed, comes from the same statusMeta call that drives the
   trailing StatusPill — one source, one read. It only paints the legacy
   palette's leading edge; every other attribute on the item is untouched. */
export function ListItem({ icon, title, support, trailing, onClick, disabled, tone, children, ...rest }) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper className="list-item" onClick={onClick} disabled={disabled || undefined} data-tone={tone ?? undefined} {...rest}>
      {icon ? (
        <span className="list-item__leading">
          <Icon name={icon} size={24} />
        </span>
      ) : null}
      <span className="list-item__text">
        <span className="list-item__title">{title}</span>
        {support ? <span className="list-item__support">{support}</span> : null}
        {children}
      </span>
      {trailing ? <span className="list-item__trailing">{trailing}</span> : null}
    </Wrapper>
  )
}

/* Status pill.
   Colour is never the only signal: every pill carries its text label, and each
   status also carries a distinct dot *shape* so it survives greyscale and
   colour-vision deficiency. See architecture.md constraint 9. */
const TONE = {
  neutral: 'neutral',
  progress: 'progress',
  action: 'action',
  done: 'done',
  warn: 'warn',
  error: 'error',
}

const SHAPE = {
  round: 'round',
  square: 'square',
  triangle: 'triangle',
  diamond: 'diamond',
  ring: 'ring',
  bar: 'bar',
  half: 'half',
}

/* A status pill.
 *
 * `shape` draws a dot for the status domains that have distinct marks —
 * appointments, size classes, the wrap/take-off pair on the card. The card
 * stages deliberately have none: nine arbitrary glyphs had to be memorised, and
 * the stages only ever run in one order, so `progress` (0–1) draws how far along
 * a fixed rail the card sits instead. `variant="quiet"` is the row treatment —
 * unfilled, the tone on its leading edge — while a detail page keeps the fill.
 */
export function StatusPill({ tone = 'neutral', shape, progress, variant, children, className = '' }) {
  const classes = [
    'status-pill',
    `status-pill--${TONE[tone] ?? tone}`,
    variant && `status-pill--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={classes}>
      {shape ? <span className={`status-pill__dot status-pill__dot--${SHAPE[shape] ?? shape}`} /> : null}
      {children}
      {typeof progress === 'number' ? (
        <span className="status-pill__rail" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden="true" />
      ) : null}
    </span>
  )
}

export function Badge({ dot, children, className = '' }) {
  const classes = ['badge', dot && 'badge--dot', className].filter(Boolean).join(' ')
  return <span className={classes}>{children}</span>
}

export function KeyValue({ rows }) {
  return (
    <dl className="kv">
      {rows.map(({ k, v }) =>
        v === null || v === undefined || v === '' ? null : (
          <div key={k} style={{ display: 'contents' }}>
            <dt className="kv__k">{k}</dt>
            <dd className="kv__v">{v}</dd>
          </div>
        ),
      )}
    </dl>
  )
}