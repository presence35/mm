import { useCallback, useState } from 'react'
import CardDetail from '../features/card/CardDetail.jsx'
import { useCard } from '../features/card/useCard.js'
import { useConflicts } from '../features/conflicts/useConflicts.js'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import * as idb from '../engines/store/idb.js'
import * as media from '../engines/media/photos.js'
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

  const openSchedule = useCallback(() => {
    navigate('schedule', { cardId: params.id })
  }, [navigate, params.id])

  /* Photo capture returns an outcome rather than throwing at the view: the
     strip has to render "not saved, waiting for signal" as a state, and a
     thrown error crossing a component boundary made that impossible. */
  const capturePhoto = useCallback(
    async ({ photoType, workLogId, caption } = {}) => {
      try {
        const out = await media.captureAndUpload({
          cardId: params.id,
          token: media.storedToken(),
          deviceId: await idb.deviceId(),
          signal: sync.online,
          photoType,
          workLogId,
          caption,
        })
        if (!out) return null
        return { ok: true, bytes: out.bytes }
      } catch (e) {
        return { ok: false, reason: e.offline ? 'offline' : e.unauthorized ? 'unauthorized' : 'failed' }
      }
    },
    [params.id, sync.online],
  )

  const deletePhoto = useCallback(async (photo) => {
    try {
      await media.deletePhoto({ photo, deviceId: await idb.deviceId(), token: media.storedToken() })
      return { ok: true }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }, [])

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
          capturePhoto,
          deletePhoto,
          onOpenInvoice: openInvoice,
          onOpenSchedule: openSchedule,
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
