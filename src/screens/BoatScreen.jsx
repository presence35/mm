import { useEffect, useState } from 'react'
import { TopBar, EmptyState } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import * as store from '../engines/store/localStore.js'
import BoatEdit from '../features/boat/BoatEdit.jsx'

export default function BoatScreen({ params = {} }) {
  const { goBack } = useRouter()
  const [record, setRecord] = useState(() => store.getBoat(params.id))

  useEffect(() => {
    const refresh = () => setRecord(store.getBoat(params.id))
    store.subscribe(refresh)
    refresh()
    return () => store.subscribe(refresh)
  }, [params.id])

  if (!record) {
    return (
      <div>
        <TopBar title="Boat" onBack={goBack} />
        <EmptyState icon="boat" title="Boat not found" />
      </div>
    )
  }

  const { boat } = record

  return (
    <div>
      <TopBar title={boat.name || boat.model || 'Unnamed boat'} onBack={goBack} />
      <BoatEdit record={record} />
    </div>
  )
}
