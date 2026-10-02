import { useCallback } from 'react'
import CardDetail from '../features/card/CardDetail.jsx'
import { useCard } from '../features/card/useCard.js'
import { useRouter } from '../shell/RouterProvider.jsx'

export default function CardDetailScreen({ params = {}, embedded = false, selected = true }) {
  const { goBack, setDirty } = useRouter()
  const api = useCard(selected ? params.id : null)

  const onAddPhoto = useCallback(() => {
    /* Camera + upload lands in the sync phase. */
  }, [])

  return (
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
        online: true,
        onAddPhoto,
        onRetryUpload: () => {},
      }}
    />
  )
}