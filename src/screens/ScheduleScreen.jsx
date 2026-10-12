import { useMemo } from 'react'
import { TopBar } from '../ui'
import ScheduleBoard from '../features/schedule/ScheduleBoard.jsx'
import { useSchedule, useScheduleActions } from '../features/schedule/useSchedule.js'
import { useCards } from '../features/card/useCard.js'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import * as store from '../engines/store/localStore.js'

/*
 * Schedule — contextual, reached from Cards or from a card.
 *
 * It adopts the Cards destination: navigation highlighting and the expanded
 * layout both treat it as part of Cards, because M3 caps the navigation bar at
 * five destinations and this is not a sixth.
 *
 * `now` is taken once per render and passed down. Nothing below this screen
 * calls Date.now(), which is what makes "is this overdue" testable.
 */
export default function ScheduleScreen({ params = {} }) {
  const { goBack } = useRouter()
  const { may } = useAuth()
  const rows = useSchedule({ cardId: params.cardId ?? null })
  const { save, transition } = useScheduleActions()
  const cards = useCards()

  const now = useMemo(() => new Date().toISOString(), [])

  const pickable = useMemo(
    () =>
      cards.map((card) => {
        const record = store.getCard(card.id)
        return { id: card.id, work_order_no: card.work_order_no, boat_id: card.boat_id, customer_id: record?.boat?.customer_id ?? null }
      }),
    [cards],
  )

  return (
    <div>
      <TopBar
        title={params.cardId ? 'Schedule for this card' : 'Schedule'}
        onBack={goBack}
      />
      <ScheduleBoard
        rows={rows}
        cards={pickable}
        now={now}
        canBook={may(CAPABILITIES.BOOK_APPOINTMENT)}
        onSave={save}
        onTransition={transition}
        selectedCardId={params.cardId ?? ''}
      />
    </div>
  )
}
