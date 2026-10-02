import { TopBar, ListItem, EmptyState } from '../ui'

/* Camera + QR scanning arrive with the sync phase (tesseract OCR, HEIC
   conversion and photo compression all need a device pipeline). */
export default function ScanScreen() {
  return (
    <div>
      <TopBar title="Scan" />
      <EmptyState
        icon="qr"
        title="Scanner not available yet"
        body="Photograph a paper intake card to create it, or scan a customer's QR code to open their view."
      />
      <ListItem icon="camera" title="Scan a paper intake card" support="Coming with the capture phase" />
      <ListItem icon="qr" title="Scan a customer QR code" support="Coming with the public view" />
    </div>
  )
}