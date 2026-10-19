import { useEffect, useState } from 'react'
import { Button, Icon, IconButton, StatusPill, EmptyState, Chip, ChipRow } from '../../ui'
import { PHOTO_TYPES, photoTypeLabel, fetchPhotoObjectUrl, storedToken } from '../../engines/media/photos.js'

/*
 * Photos.
 *
 * The camera always works — a worker must never lose the ability to look at a
 * boat. What does not work offline is the upload, so the shutter lands in an
 * explicit blocked state with a reason and a retry, and never in a state that
 * could be mistaken for a saved photo.
 *
 * Presentation only: capture, upload and deletion are injected. The card
 * gallery and an individual log entry render the same tiles, because a photo
 * belongs where the work it documents happened, not only on a gallery page.
 */

const BLOCKED_COPY = {
  offline: 'Photos upload when you have signal. Everything else on this card is already saved on this device.',
  unauthorized: 'Sign in again to upload photos.',
  failed: 'The upload did not go through. Your notes are safe. You can take the photo again.',
}

const TILE = {
  minWidth: 132,
  height: 100,
  borderRadius: 'var(--corner-m)',
  background: 'var(--surface-container-highest)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--on-surface-variant)',
  overflow: 'hidden',
  position: 'relative',
}

/* Bytes need the session (an <img> cannot send a Bearer header), so every row
   is fetched with the token and shown as an object URL. A row without a file —
   60 of them after the legacy import — renders as a tile that says so, never a
   broken image. */
function useThumbnails(cardId, photos) {
  const [urls, setUrls] = useState({})
  const [missing, setMissing] = useState([])

  useEffect(() => {
    let cancelled = false
    const created = []
    const token = storedToken()

    ;(async () => {
      const entries = await Promise.all(
        photos.map(async (p) => {
          const key = p.id ?? p.filename
          const url = await fetchPhotoObjectUrl({ cardId, filename: p.filename, token })
          if (url) created.push(url)
          return [key, url]
        }),
      )
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u))
        return
      }
      setUrls(Object.fromEntries(entries))
      setMissing(entries.filter(([, u]) => !u).map(([k]) => k))
    })()

    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [cardId, photos])

  return { urls, missing }
}

/* One photo's bytes, for a caller that shows a single image — the watermark
   behind the card header. The dependency is the row's identity rather than the
   array, because the card projection rebuilds its arrays on every read and a
   re-render must not refetch the same bytes. */
export function usePhotoUrl(cardId, photo) {
  const [url, setUrl] = useState(null)
  const id = photo?.id ?? photo?.filename ?? null
  const filename = photo?.filename ?? null

  useEffect(() => {
    if (!id || !filename) {
      setUrl(null)
      return
    }
    let cancelled = false
    let created = null
    ;(async () => {
      const next = await fetchPhotoObjectUrl({ cardId, filename, token: storedToken() })
      if (cancelled) {
        if (next) URL.revokeObjectURL(next)
        return
      }
      created = next
      setUrl(next)
    })()
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [cardId, id, filename])

  return url
}

function Tile({ photo, url, gone, confirming, onConfirm, onOpen, onRequestDelete, compact }) {
  return (
    <figure
      onClick={url ? onOpen : undefined}
      title={url ? 'Open full photo' : undefined}
      style={{ ...TILE, minWidth: compact ? 88 : TILE.minWidth, height: compact ? 68 : TILE.height, margin: 0, cursor: url ? 'pointer' : 'default' }}
    >
      {url ? (
        <img src={url} alt={photo.caption || photoTypeLabel(photo.photo_type)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <>
          <Icon name="camera" size={compact ? 20 : 28} />
          {gone ? (
            <span style={{ position: 'absolute', bottom: 4, font: 'var(--label-s)', padding: '0 4px' }}>No image file</span>
          ) : null}
        </>
      )}

      {onRequestDelete ? (
        confirming ? (
          <span style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
            <IconButton icon="close" label="Keep photo" onClick={() => onConfirm('keep')} />
            <IconButton icon="trash" label="Confirm delete photo" onClick={() => onConfirm('delete')} />
          </span>
        ) : (
          <span style={{ position: 'absolute', top: 2, right: 2 }} onClick={(e) => e.stopPropagation()}>
            <IconButton icon="trash" label="Delete photo" onClick={onRequestDelete} />
          </span>
        )
      ) : null}

      {photo.caption ? (
        <figcaption
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            font: 'var(--label-s)',
            color: 'var(--on-surface)',
            background: 'var(--surface-container-highest)',
            padding: '0 var(--space-1)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {photo.caption}
        </figcaption>
      ) : null}
      <span style={{ position: 'absolute', top: 2, left: 2 }}>
        <StatusPill tone="neutral" shape="square">
          {photoTypeLabel(photo.photo_type)}
        </StatusPill>
      </span>
    </figure>
  )
}

/* Inline gallery for one log entry: the photos taken while writing it. */
export function PhotoTiles({ cardId, photos, compact = true }) {
  const { urls, missing } = useThumbnails(cardId, photos)
  if (!photos.length) return null
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', paddingTop: 'var(--space-2)' }}>
      {photos.map((p) => {
        const key = p.id ?? p.filename
        const url = urls[key]
        return (
          <Tile
            key={key}
            photo={p}
            url={url}
            gone={missing.includes(key)}
            compact={compact}
            onOpen={url ? () => window.open(url, '_blank', 'noopener') : undefined}
          />
        )
      })}
    </div>
  )
}

export default function PhotoStrip({ cardId, photos, online, onCapture, onDelete, onRetryUpload, emptyHint }) {
  const { urls, missing } = useThumbnails(cardId, photos)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(null)
  const [saved, setSaved] = useState(null)
  const [filter, setFilter] = useState('all')
  const [confirmingId, setConfirmingId] = useState(null)

  const shown = filter === 'all' ? photos : photos.filter((p) => (p.photo_type ?? 'general') === filter)

  const add = async () => {
    setBusy(true)
    setBlocked(null)
    const outcome = await onCapture?.({ photoType: 'general' })
    setBusy(false)
    if (!outcome) return
    if (outcome.ok) {
      setSaved(outcome.bytes ? `${(outcome.bytes / 1024).toFixed(0)} KB · uploaded` : 'Photo uploaded')
      setTimeout(() => setSaved(null), 4000)
    } else {
      setBlocked({ reason: outcome.reason, name: outcome.name })
    }
  }

  const remove = async (photo) => {
    const outcome = await onDelete?.(photo)
    if (outcome && !outcome.ok) setBlocked({ reason: outcome.reason, name: photo.caption || photo.filename })
  }

  if (!photos.length) {
    return (
      <div>
        <EmptyState
          icon="camera"
          title="No photos yet"
          body={emptyHint ?? 'Photograph any damage at intake — it protects you and the customer later.'}
          action={{ label: 'Take a photo', icon: 'camera', onClick: add }}
        />
        <BlockedBanner blocked={blocked} online={online} onRetryUpload={onRetryUpload} onDismiss={() => setBlocked(null)} />
      </div>
    )
  }

  return (
    <div>
      <ChipRow>
        <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Chip>
        {PHOTO_TYPES.map((t) => (
          <Chip key={t.value} selected={filter === t.value} onClick={() => setFilter(t.value)}>
            {t.label}
          </Chip>
        ))}
      </ChipRow>

      <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', padding: 'var(--space-2) var(--space-4)' }}>
        {shown.map((p) => {
          const key = p.id ?? p.filename
          const url = urls[key]
          const gone = missing.includes(key)
          return (
            <Tile
              key={key}
              photo={p}
              url={url}
              gone={gone}
              compact={false}
              confirming={confirmingId === key}
              onOpen={url ? () => window.open(url, '_blank', 'noopener') : undefined}
              onRequestDelete={() => setConfirmingId(key)}
              onConfirm={(action) => {
                setConfirmingId(null)
                if (action === 'delete') remove(p)
              }}
            />
          )
        })}
      </div>

      {shown.length === 0 ? (
        <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-2)' }}>
          No {photoTypeLabel(filter).toLowerCase()} photos on this card.
        </p>
      ) : null}

      {busy ? (
        <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4)' }}>
          Compressing and uploading…
        </p>
      ) : null}

      {saved ? (
        <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4)' }}>{saved}</p>
      ) : null}

      <BlockedBanner blocked={blocked} online={online} onRetryUpload={onRetryUpload} onDismiss={() => setBlocked(null)} />

      {blocked ? null : (
        <div style={{ padding: 'var(--space-2) var(--space-4) var(--space-4)' }}>
          <Button variant="tonal" icon="camera" onClick={add} loading={busy}>
            Add photo
          </Button>
        </div>
      )}
    </div>
  )
}

/* Non-dismissible in the sense that matters: the worker must know the photo is
   NOT saved. The label is the signal, not the colour. */
function BlockedBanner({ blocked, online, onRetryUpload, onDismiss }) {
  if (!blocked) return null
  return (
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
          Not saved — waiting for signal
        </StatusPill>
      </div>
      <p style={{ font: 'var(--body-m)', marginTop: 'var(--space-2)' }}>
        {BLOCKED_COPY[blocked.reason] ?? BLOCKED_COPY.failed}
      </p>
      {blocked.name ? (
        <p style={{ font: 'var(--body-s)', marginTop: 'var(--space-1)', opacity: 0.8 }}>{blocked.name}</p>
      ) : null}
      <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
        <Button variant="outlined" size="sm" icon="sync" onClick={onRetryUpload} disabled={!online}>
          Retry now
        </Button>
        <Button variant="text" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
