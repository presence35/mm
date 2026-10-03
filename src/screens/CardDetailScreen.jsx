import { useCallback, useState } from 'react'
import CardDetail from '../features/card/CardDetail.jsx'
import { useCard } from '../features/card/useCard.js'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { Snackbar } from '../ui'

export default function CardDetailScreen({ params = {}, embedded = false, selected = true }) {
  const { goBack, setDirty, navigate } = useRouter()
  const { may, refuseReason } = useAuth()
  const sync = useSync()
  const api = useCard(selected ? params.id : null)
  const [toast, setToast] = useState(null)

  const openInvoice = useCallback(() => {
    if (!may(CAPABILITIES.INVOICE)) {
      setToast(refuseReason(CAPABILITIES.INVOICE))
      return
    }
    navigate('invoice', { id: params.id })
  }, [may, refuseReason, navigate, params.id])

  const copyCustomerLink = useCallback(async () => {
    const token = api.record?.card?.customer_token
    if (!token) return
    const url = `${window.location.origin}/?wo=${encodeURIComponent(token)}`
    try {
      await navigator.clipboard.writeText(url)
      setToast('Customer link copied')
    } catch {
      setToast(url)
    }
  }, [api.record])

  return (
    <>
      <CardDetail
        record={api.record}
        embedded={embedded}
        selected={selected}
        onBack={goBack}
        onDirtyChange={setDirty}
        actions={{
          patch: api.patch,
          rate: api.rate,
          toggleReceivedItem: api.toggleReceivedItem,
          toggleAuthorized: api.toggleAuthorized,
          toggleCompleted: api.toggleCompleted,
          addLog: api.addLog,
          online: sync.online,
          onAddPhoto: () => setToast('Camera arrives with the capture phase'),
          onRetryUpload: () => sync.syncNow(),
          onOpenInvoice: openInvoice,
          onCopyCustomerLink: copyCustomerLink,
        }}
      />
      <Snackbar message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}