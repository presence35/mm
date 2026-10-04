import { useCallback, useState } from 'react'
import CardDetail from '../features/card/CardDetail.jsx'
import { useCard } from '../features/card/useCard.js'
import { useConflicts } from '../features/conflicts/useConflicts.js'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { Snackbar } from '../ui'

export default function CardDetailScreen({ params = {}, embedded = false, selected = true }) {
  const { goBack, setDirty, navigate } = useRouter()
  const { may, refuseReason } = useAuth()
  const sync = useSync()
  const api = useCard(selected ? params.id : null)
  const { conflicts } = useConflicts()
  const [toast, setToast] = useState(null)

  const openInvoice = useCallback(() => {
    if (!may(CAPABILITIES.INVOICE)) {
      setToast(refuseReason(CAPABILITIES.INVOICE))
      return
    }
    navigate('invoice', { id: params.id })
  }, [may, refuseReason, navigate, params.id])

  const customerUrl = api.record?.card?.customer_token
    ? `${window.location.origin}/?wo=${encodeURIComponent(api.record.card.customer_token)}`
    : null

  const copyCustomerLink = useCallback(async () => {
    if (!customerUrl) return
    try {
      await navigator.clipboard.writeText(customerUrl)
      setToast('Customer link copied')
    } catch {
      setToast(customerUrl)
    }
  }, [customerUrl])

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
    note: api.note,
          toggleReceivedItem: api.toggleReceivedItem,
          toggleAuthorized: api.toggleAuthorized,
          toggleCompleted: api.toggleCompleted,
          addLog: api.addLog,
          online: sync.online,
          onRetryUpload: () => sync.syncNow(),
          onOpenInvoice: openInvoice,
          onCopyCustomerLink: copyCustomerLink,
          customerUrl,
          conflictedIds: conflicts.filter((c) => c.entity_id === params.id).map((c) => c.entity_id),
          onResolveConflicts: () => navigate('conflicts'),
        }}
      />
      <Snackbar message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}