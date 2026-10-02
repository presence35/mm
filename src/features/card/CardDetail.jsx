import { useState } from 'react'
import {
  Button,
  IconButton,
  TopBar,
  Sheet,
  StatusPill,
  KeyValue,
  ProgressLinear,
  Divider,
} from '../../ui'
import { statusMeta, nextStatuses, progressPercent, CARD_STATUS } from '../../domain/cardStatus.js'
import { locationSummary, STORAGE_TYPES } from '../../domain/storageLocation.js'
import { SEED_RECEIVED_ITEMS, SEED_AUTHORIZED_WORK, SEED_CONDITIONS } from '../../engines/store/seed.js'
import ConditionEditor from './ConditionEditor.jsx'
import { ReceivedItems, AuthorizedWork, WrapControl } from './TaskList.jsx'
import LogComposer, { LogList } from './LogComposer.jsx'
import PhotoStrip from './PhotoStrip.jsx'

/* Pure presentation. Every prop arrives ready to render; no store access,
   no fetch, no localStorage. */

const RECEIVED_LABELS = Object.fromEntries(SEED_RECEIVED_ITEMS.map((k) => [k, k.replace(/_/g, ' ')]))

export default function CardDetail({ record, embedded, selected, onBack, onDirtyChange, actions }) {
  const [statusSheet, setStatusSheet] = useState(false)

  if (!record) {
    // Nothing chosen yet is not an error — it is the empty detail pane.
    if (!selected) {
      return (
        <div className="state-view">
          <p className="state-view__title">No card selected</p>
          <p className="state-view__body">Pick a card from the list to see its work and log.</p>
        </div>
      )
    }
    return (
      <div className="state-view">
        <p className="state-view__title">Card not found</p>
        <p className="state-view__body">
          It may have been removed on another device. Reconnect to pull the latest cards.
        </p>
      </div>
    )
  }

  const { card, boat, customer } = record
  const meta = statusMeta(card.status)
  const options = nextStatuses(card.status)
  const storageLabel = STORAGE_TYPES.find((t) => t.value === card.storage_type)?.label ?? '—'

  return (
    <div>
      {!embedded ? (
        <TopBar
          title={card.work_order_no}
          onBack={onBack}
          actions={
            <IconButton icon="dots" label="More actions" />
          }
        />
      ) : null}

      {/* Conflict is a first-class state, not a toast. Both versions survive. */}
      {card.conflict ? (
        <div className="offline-bar offline-bar--conflict" role="alert">
          <Icon2 />
          Needs review — this card changed on another device
          <span className="spacer" />
          <Button variant="text" size="sm">
            Resolve
          </Button>
        </div>
      ) : null}

      <header style={{ padding: 'var(--space-4)' }}>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <StatusPill tone={meta.tone} shape={meta.shape}>
            {meta.label}
          </StatusPill>
          {card.is_scanned ? (
            <StatusPill tone="neutral" shape="square">
              Scanned
            </StatusPill>
          ) : null}
        </div>

        <h2 style={{ font: 'var(--headline-s)', marginTop: 'var(--space-3)' }}>
          {boat?.name || boat?.model || 'Unnamed boat'}
        </h2>
        <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)' }}>
          {[customer?.name, boat?.motor_type, boat?.licence].filter(Boolean).join(' · ')}
        </p>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <ProgressLinear value={Math.round(progressPercent(card.status) * 100)} />
        </div>
      </header>

      <Divider />

      <KeyValue
        rows={[
          { k: 'Work order', v: card.work_order_no },
          { k: 'Season', v: card.season_year },
          { k: 'Date in', v: card.date_in },
          { k: 'Date out', v: card.date_out },
          { k: 'Storage type', v: storageLabel },
          { k: 'Location', v: locationSummary(card) },
          { k: 'Length', v: boat?.length_ft ? `${boat.length_ft} ft` : null },
          { k: 'Pickup', v: card.pickup_delivery },
          { k: 'Remarks', v: card.remarks },
          { k: 'Other work', v: card.other_work },
        ]}
      />

      <Divider />

      <ReceivedItems
        items={Object.keys(RECEIVED_LABELS)}
        selected={card.received_items ?? []}
        onToggle={actions.toggleReceivedItem}
      />

      <AuthorizedWork
        work={(card.authorized_work ?? []).map((w) => ({
          ...w,
          key: w.key,
          label: SEED_AUTHORIZED_WORK.find((s) => s.key === w.key)?.label ?? w.key,
        }))}
        onToggleAuthorized={actions.toggleAuthorized}
        onToggleCompleted={actions.toggleCompleted}
      />

      <Divider />

      <ConditionEditor areas={SEED_CONDITIONS} condition={card.condition} onRate={actions.rate} />

      <Divider />

      <WrapControl
        wrapRequired={card.wrap_required}
        unwrapDone={card.unwrap_done}
        onChange={actions.patch}
      />

      <Divider />

      <PhotoStrip photos={card.photos ?? []} online={actions.online} onAdd={actions.onAddPhoto} onRetry={actions.onRetryUpload} />

      <Divider />

      <div className="section-head">Work log</div>
      <LogList logs={card.logs ?? []} />
      <LogComposer onSave={actions.addLog} onDirtyChange={onDirtyChange} />

      {/* One dominant action per screen: move the card forward. */}
      <div style={{ padding: '0 var(--space-4) var(--space-6)' }}>
        <Button fullWidth onClick={() => setStatusSheet(true)} iconAfter="down" disabled={!options.length}>
          Move to…
        </Button>
      </div>

      <Sheet open={statusSheet} title="Change status" onDismiss={() => setStatusSheet(false)}>
        {options.length ? (
          options.map((s) => (
            <Button
              key={s}
              fullWidth
              variant="text"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => {
                actions.patch({ status: s })
                setStatusSheet(false)
              }}
            >
              {CARD_STATUS[s].label}
            </Button>
          ))
        ) : (
          <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)' }}>
            This card is archived. Nothing further to do.
          </p>
        )}
      </Sheet>
    </div>
  )
}

function Icon2() {
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 2.5 20h19z M12 9v5 M12 17.5h.01" />
      </svg>
    </span>
  )
}