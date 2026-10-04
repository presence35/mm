import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/*
 * The customer's QR.
 *
 * The public view has existed since the contract was written and has been
 * unreachable: the token was on the card, the route worked, and nothing ever
 * produced the code a customer is meant to scan. This is that missing piece.
 *
 * Generated with the qrcode library rather than hand-rolled. A QR encoder is
 * Reed-Solomon error correction plus version selection plus mask scoring, and a
 * subtle mistake produces a square that looks like a QR code and silently will
 * not scan — in a customer's hand, on a dock, with nobody to debug it. There is
 * no way to check a hand-rolled encoder by reading it short of writing a decoder
 * too, and that is more code than using a correct one.
 *
 * The URL is always shown as text beneath the code. A phone camera failing to
 * focus in salt spray is a normal Tuesday, and a customer who can read the link
 * aloud is not stuck.
 */
export default function CustomerQr({ url, name, boatName, workOrderNo }) {
  const [svg, setSvg] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!url) return undefined
    let live = true
    setSvg(null)
    setFailed(false)

    QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      /* Scanned off a printed card on a phone, often in poor light. */
      width: 320,
      color: { dark: '#000000ff', light: '#ffffffff' },
    })
      .then((out) => {
        if (live) setSvg(out)
      })
      .catch(() => {
        if (live) setFailed(true)
      })

    return () => {
      live = false
    }
  }, [url])

  if (!url) {
    return (
      <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: 'var(--space-4)' }}>
        This card has no customer link yet.
      </p>
    )
  }

  return (
    <div className="qr">
      <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', textAlign: 'center' }}>
        Scan to see how {name ?? 'your boat'} is doing
      </p>

      {svg ? (
        /* Injected rather than a data URL: it stays crisp at any size and
            costs nothing to cache. qrcode emits no script or external refs. */
        <div className="qr__code" role="img" aria-label={`QR code linking to the customer view for ${workOrderNo ?? 'this card'}`} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : failed ? (
        <div className="qr__code qr__code--failed">
          <p style={{ font: 'var(--body-s)' }}>The code could not be drawn. Use the link below.</p>
        </div>
      ) : (
        <div className="qr__code" aria-hidden="true" />
      )}

      <p className="qr__meta">{[name, boatName].filter(Boolean).join(' · ')}</p>
      <p className="qr__url">{url}</p>
    </div>
  )
}