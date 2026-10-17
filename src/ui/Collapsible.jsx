import { useId, useState } from 'react'
import Icon from './Icon'

/*
 * Collapsible section — one line when closed, the detail when open.
 *
 * A card carries ten sections and a worker scrolls past nine of them to reach
 * the tenth. Each section therefore opens to a single summary line and expands
 * on demand, which is what keeps a card readable on a phone on a dock.
 *
 * Stateless beyond its own open/closed flag: it renders whatever summary and
 * children it is handed, and knows nothing about cards.
 */

export default function Collapsible({ title, summary, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  const panelId = `${id}-panel`
  const buttonId = `${id}-button`

  return (
    <section className="collapsible" data-open={open ? 'true' : 'false'}>
      <h3 style={{ margin: 0 }}>
        <button
          id={buttonId}
          type="button"
          className="collapsible__head"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="down" size={24} className="collapsible__chevron" />
          <span className="collapsible__title">{title}</span>
          {typeof count === 'number' && count > 0 ? <span className="collapsible__count">{count}</span> : null}
          {!open && summary ? <span className="collapsible__summary">{summary}</span> : null}
        </button>
      </h3>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open} className="collapsible__panel">
        {open ? children : null}
      </div>
    </section>
  )
}
