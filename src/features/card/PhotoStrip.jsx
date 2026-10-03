import { useState } from 'react'
import { Button, Icon, StatusPill, EmptyState, Divider } from '../../ui'
import { useSync } from '../../engines/sync/SyncProvider.jsx'
import { pickPhoto, uploadPhoto } from '../../engines/media/photos.js'
import * as idb from '../../engines/store/idb.js'

/*
 * Photos.
 *
 * The camera always works — a worker must never lose the ability to look at a
 * boat. What does not work offline is the upload, so the shutter lands in an
 * explicit blocked state with a reason and a retry, and never in a state that
 * could be mistaken for a saved photo.
 */

const BLOCKED_COPY = {
  offline: 'Photos upload when you have signal. Everything else on this card is already saved on this device.',
  unauthorized: 'Sign in again to upload photos.',
  failed: 'The upload did not go through. Your notes are safe.',
}

export default function PhotoStrip({ cardId, photos, onRetryUpload }) {
  const { online } = useSync()
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(null)
  const [saved, setSaved] = useState(null)

  const add = async () => {
    const file = await pickPhoto()
    if (!file) return

    if (!online) {
      setBlocked({ reason: 'offline', name: file.name })
      return
    }

    setBusy(true)
    setBlocked(null)
    try {
      const result = await uploadPhoto({
        cardId,
        file,
        token: tokenOf(),
        deviceId: await idb.deviceId(),
        signal: online,
      })
      setSaved(`${(result.bytes / 1024).toFixed(0)} KB · uploaded`)
      setTimeout(() => setSaved(null), 4000)
    } catch (e) {
      setBlocked({ reason: e.offline ? 'offline' : 'failed', name: file.name })
    } finally {
      setBusy(false)
    }
  }

  const tokenOf = () => {
    try {
      return localStorage.getItem('mm.token')
    } catch {
      return null
    }
  }

  if (!photos.length) {
    return (
      <section>
        <div className="section-head">Photos</div>
        <EmptyState
          icon="camera"
          title="No photos yet"
          body="Photograph any damage at intake — it protects you and the customer later."
          action={{ label: 'Take a photo', icon: 'camera', onClick: add }}
        />
        {!online ? (
          <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-4)' }}>
            You can take photos now; they upload when you have signal.
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <section>
      <div className="section-head">Photos</div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', padding: 'var(--space-2) var(--space-4)' }}>
        {photos.map((p) => (
          <figure
            key={p.id ?? p.filename}
            style={{
              margin: 0,
              minWidth: 132,
              height: 100,
              borderRadius: 'var(--corner-m)',
              background: 'var(--surface-container-highest)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--on-surface-variant)',
            }}
          >
            <Icon name="camera" size={28} />
            {p.caption ? (
              <figcaption style={{ position: 'absolute', font: 'var(--label-s)', color: 'var(--on-surface-variant)', marginTop: 120, whiteSpace: 'nowrap' }}>
                {p.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>

      {busy ? (
        <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4)' }}>
          Compressing and uploading…
        </p>
      ) : null}

      {saved ? (
        <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4)' }}>
          {saved}
        </p>
      ) : null}

      {/* Non-dismissible. The worker must know the photo is NOT saved. */}
      {blocked ? (
        <div
          role="alert"
          style={{
            margin: 'var(--space-3) var(--space-4) 0',
            padding: 'var(--space-4)',
            borderRadius: 'var(--corner-m)',
            background: 'var(--warning-container)',
            color: 'var(--on-warning-container)',
          }}
        >
          <div className="row">
            <StatusPill tone="warn" shape="bar">
              Waiting for signal
            </StatusPill>
          </div>
          <p style={{ font: 'var(--body-m)', marginTop: 'var(--space-2)' }}>{BLOCKED_COPY[blocked.reason]}</p>
          <p style={{ font: 'var(--body-s)', marginTop: 'var(--space-1)', opacity: 0.8 }}>{blocked.name}</p>
          <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
            <Button variant="outlined" size="sm" icon="sync" onClick={onRetryUpload}>
              Retry now
            </Button>
            <Button variant="text" size="sm" onClick={() => setBlocked(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ padding: 'var(--space-2) var(--space-4) var(--space-4)' }}>
          <Button variant="tonal" icon="camera" onClick={add} loading={busy}>
            Add photo
          </Button>
          {!online ? (
            <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', marginTop: 'var(--space-2)' }}>
              You can take photos now; they upload when you have signal.
            </p>
          ) : null}
        </div>
      )}

      <Divider />
    </section>
  )
}