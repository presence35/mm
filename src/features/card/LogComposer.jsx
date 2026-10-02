import { useState, useEffect } from 'react'
import { Button, TextField, Icon } from '../../ui'

/* Log composer.
   Owns its own draft state and marks the router dirty while there is
   unsaved text, so an accidental back gesture cannot discard it. */
export default function LogComposer({ onSave, onDirtyChange }) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState('idle')

  const dirty = text.trim().length > 0

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const save = () => {
    if (!dirty) return
    setMode('saving')
    // Local store write is synchronous; the sync engine drains later.
    onSave({ description: text.trim() })
    setText('')
    setMode('idle')
  }

  return (
    <section style={{ paddingBottom: 'var(--space-4)' }}>
      <div className="section-head">Add a log entry</div>
      <TextField
        label="What did you do?"
        value={text}
        onChange={setText}
        multiline
        placeholder="Lower unit drained, refill with fresh oil…"
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-3) var(--space-4) 0' }}>
        <Button onClick={save} disabled={!dirty} loading={mode === 'saving'}>
          Save entry
        </Button>
      </div>
    </section>
  )
}

export function LogList({ logs }) {
  if (!logs.length) {
    return (
      <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-4)' }}>
        No log entries yet.
      </p>
    )
  }

  return (
    <div>
      {logs.map((log) => (
        <article
          key={log.id}
          style={{
            padding: 'var(--space-3) var(--space-4)',
            boxShadow: 'inset 0 1px 0 var(--outline-variant)',
          }}
        >
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <Icon name="calendar" size={16} />
            <span style={{ font: 'var(--label-m)', color: 'var(--on-surface-variant)' }}>
              {log.date} · {log.name}
            </span>
          </div>
          <p style={{ font: 'var(--body-m)', marginTop: 'var(--space-1)' }}>{log.description}</p>
          {log.transcription ? (
            <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', marginTop: 'var(--space-1)' }}>
              Scanned: {log.transcription}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  )
}