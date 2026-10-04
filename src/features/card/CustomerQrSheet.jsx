import { useState } from 'react'
import { Button, Sheet } from '../../ui'
import CustomerQr from './CustomerQr.jsx'

/*
 * Shown by the "Customer link" action. The link used to be copied and that was
 * the end of it; the customer was never meant to receive a pasted URL.
 */
export default function CustomerQrSheet({ open, url, name, boatName, workOrderNo, onDismiss, onCopy }) {
  const [copied, setCopied] = useState(false)

  return (
    <Sheet open={open} title="Customer view" onDismiss={onDismiss}>
      <CustomerQr url={url} name={name} boatName={boatName} workOrderNo={workOrderNo} />

      <div style={{ padding: 'var(--space-4)' }}>
        <Button
          fullWidth
          variant="tonal"
          onClick={async () => {
            await onCopy?.()
            setCopied(true)
          }}
        >
          {copied ? 'Link copied' : 'Copy link instead'}
        </Button>
      </div>
    </Sheet>
  )
}