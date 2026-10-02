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

export function ListItem({ icon, title, support, trailing, onClick, disabled, children, ...rest }) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper className="list-item" onClick={onClick} disabled={disabled || undefined} {...rest}>
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

export function StatusPill({ tone = 'neutral', shape = 'round', children, className = '' }) {
  const classes = ['status-pill', `status-pill--${TONE[tone] ?? tone}`, className].filter(Boolean).join(' ')
  return (
    <span className={classes}>
      <span className={`status-pill__dot status-pill__dot--${SHAPE[shape] ?? shape}`} />
      {children}
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