import { useEffect, useRef } from 'react'
import Icon from './Icon'

/* Snackbar — brief, non-blocking confirmation. Success must never be a
   blocking dialog. */
export function Snackbar({ message, action, onDismiss, duration = 4000 }) {
  const timer = useRef(null)

  useEffect(() => {
    if (!message) return undefined
    timer.current = setTimeout(() => onDismiss?.(), duration)
    return () => clearTimeout(timer.current)
  }, [message, duration, onDismiss])

  if (!message) return null

  return (
    <div className="snackbar" role="status" aria-live="polite">
      <span style={{ flex: 1 }}>{message}</span>
      {action ? (
        <button
          className="snackbar__action"
          onClick={() => {
            action.onClick?.()
            onDismiss?.()
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

/* Dialog — a blocking decision that deserves interruption. Not for routine
   information, which belongs inline. */
export function Dialog({ open, title, body, actions, onDismiss }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onDismiss?.()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  if (!open) return null

  return (
    <>
      <div className="scrim" onClick={onDismiss} />
      <div className="dialog-wrap">
        <div
          className="dialog"
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          ref={ref}
        >
          {title ? <h2 className="dialog__title">{title}</h2> : null}
          {body ? <div className="dialog__body">{body}</div> : null}
          <div className="dialog__actions">{actions}</div>
        </div>
      </div>
    </>
  )
}

/* Bottom sheet — supplemental content bound to the current context. */
export function Sheet({ open, title, onDismiss, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onDismiss?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  if (!open) return null

  return (
    <>
      <div className="sheet-scrim" onClick={onDismiss} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__handle" />
        {title ? <h2 className="sheet__title">{title}</h2> : null}
        {children}
      </div>
    </>
  )
}

export function TopBar({ title, onBack, actions, centered, children }) {
  return (
    <header className={`top-bar ${centered ? 'top-bar--centered' : ''}`}>
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <Icon name="back" size={24} />
        </button>
      ) : null}
      <h1 className="top-bar__title">{title}</h1>
      {actions}
      {children}
    </header>
  )
}