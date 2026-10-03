/*
 * Photo capture.
 *
 * Photos need a connection. Deliberate — see behaviors-sync.md §Photos. Phone
 * storage is bounded and iOS may evict offline app data after ~7 days, so a
 * queued photo can be silently destroyed. The camera therefore stays usable
 * offline (a worker must always be able to look at a boat), and the shutter
 * produces an explicit blocked state rather than pretending to have saved.
 *
 * No HEIC dependency. iOS Safari decodes HEIC through an <img>, and Android
 * hands us JPEG, so canvas covers both. If a browser cannot decode the format
 * we say so plainly instead of uploading a silent failure.
 */

const MAX_EDGE = 1600
const QUALITY = 0.82

export class UploadBlocked extends Error {
  constructor(message, { pending = 0 } = {}) {
    super(message)
    this.offline = true
    this.pending = pending
  }
}

/* Explicit `now` is not needed here: nothing is time-dependent. This is a pure
   transform of an input blob into a smaller one. */
export async function compress(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const bitmap = await decode(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

  const blob = await toBlob(canvas, quality)
  return {
    blob,
    width,
    height,
    originalBytes: file.size,
    bytes: blob.size,
    type: blob.type,
  }
}

async function decode(file) {
  /* createImageBitmap handles JPEG/PNG/WebP and, on Safari, HEIC. */
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } catch (e) {
    throw new Error(`This device cannot decode ${file.type || 'that image format'}.`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

/* Location is a nice-to-have on a photo, never a blocker. */
export function currentPosition({ timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    const done = (v) => resolve(v)
    navigator.geolocation.getCurrentPosition(
      (pos) => done({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => done(null),
      { timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

export async function uploadPhoto({ cardId, file, token, deviceId, caption, photoType, workLogId, gps, signal }) {
  if (!signal) {
    throw new UploadBlocked('Photos need a connection. Everything else you wrote is already saved.', {
      pending: 0,
    })
  }

  const { blob, bytes, width, height } = await compress(file)
  const [position, auth] = await Promise.all([currentPosition(), Promise.resolve(token)])

  const form = new FormData()
  form.append('photo', blob, `${cardId}-${Date.now()}.jpg`)
  form.append('card_id', cardId)
  form.append('device_id', deviceId ?? '')
  if (caption) form.append('caption', caption)
  if (photoType) form.append('photo_type', photoType)
  if (workLogId) form.append('work_log_id', workLogId)
  const where = position ?? gps
  if (where) {
    form.append('gps_lat', String(where.lat))
    form.append('gps_lng', String(where.lng))
  }

  const res = await fetch('/api/photos', {
    method: 'POST',
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
    body: form,
  })
  if (!res.ok) throw new Error(res.status === 413 ? 'Photo is too large after compression.' : 'Upload failed.')
  return { ...(await res.json()), bytes, width, height }
}

/* Opens the camera. Returns null when the user backs out. */
export function pickPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(value)
    }

    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}