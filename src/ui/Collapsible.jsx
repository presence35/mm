import { useId, useState } from 'react'
import Icon from './Icon'
import { isSectionOpen, rememberSection } from '../engines/collapseState.js'

/*
 * Collapsible section — one line when closed, the detail when open.
 *
 * A card carries ten sections and a worker scrolls past nine of them to reach
 * the tenth. Each section therefore opens to a single summary line and expands
 * on demand, which is what keeps a card readable on a phone on a dock.
 *
 * Stateless beyond its own open/closed flag: it renders whatever summary and
 * children it is handed, and knows nothing about cards.
 *
 * `stateKey` makes that flag outlive the screen: the section opens the way the
 * worker left it, on this phone. Keys are literals at the call site, so the
 * stored set is bounded by the sections that exist rather than by how many
 * cards have been opened. No key means no memory, which is what a section that
 * only exists while something is true wants.
 *
 * `align='end'` mirrors the head — chevron at the right, count and title
 * trailing it. It is for a section that stands apart from the run of headings
 * beneath it rather than part of it.
 */

export default function Collapsible({
  title,
  summary,
  count,
  defaultOpen = false,
  stateKey,
  align = 'start',
  children,
}) {
  const [open, setOpen] = useState(() => (stateKey ? isSectionOpen(stateKey, defaultOpen) : defaultOpen))
  const id = useId()
  const panelId = `${id}-panel`
  const buttonId = `${id}-button`

  const toggle = () => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      if (stateKey) rememberSection(stateKey, next)
      return next
    })
  }

  return (
    <section className="collapsible" data-open={open ? 'true' : 'false'}>
      <h3 style={{ margin: 0 }}>
        <button
          id={buttonId}
          type="button"
          className={`collapsible__head${align === 'end' ? ' collapsible__head--end' : ''}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
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
