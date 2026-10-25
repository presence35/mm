import { useState } from 'react'
import {
  Button,
  Icon,
  IconButton,
  ListItem,
  TopBar,
  Sheet,
  StatusPill,
  KeyValue,
  Divider,
  Collapsible,
  StageStrip,
  ProgressMeter,
} from '../../ui'
import { STAGES, stagePhase, stageProgress, canTransition } from '../../domain/cardStatus.js'
import { locationSummary, STORAGE_TYPES } from '../../domain/storageLocation.js'
import { SEED_RECEIVED_ITEMS, SEED_AUTHORIZED_WORK, SEED_CONDITIONS } from '../../engines/store/seed.js'
import ConditionEditor, { summarise } from './ConditionEditor.jsx'
import CustomerQrSheet from './CustomerQrSheet.jsx'
import { ReceivedItems, AuthorizedWork, WrapControl } from './TaskList.jsx'
import LogComposer, { LogList } from './LogComposer.jsx'
import PhotoStrip, { usePhotoUrl } from './PhotoStrip.jsx'
import { mainPhoto } from '../../domain/photoPick.js'

/* Pure presentation. Every prop arrives ready to render; no store access,
   no fetch, no localStorage. */

const RECEIVED_LABELS = Object.fromEntries(SEED_RECEIVED_ITEMS.map((k) => [k, k.replace(/_/g, ' ')]))

export default function CardDetail({ record, embedded, selected, onBack, onDirtyChange, actions }) {
  const [conditionSheet, setConditionSheet] = useState(false)
  const [qrSheet, setQrSheet] = useState(false)

  /* The boat's own picture, drawn behind the card's opening lines. Decoration:
     the block reads the same with no photo, so the url may legitimately be null
     and nothing is rendered for it.

     Above the empty states on purpose. A hook behind an early return is a hook
     whose count changes the moment a card is picked, and on a wide window this
     pane renders "No card selected" first and the record second — React answers
     that with #310 (rendered more hooks than the previous render). */
  const boatPhotoUrl = usePhotoUrl(
    record?.card?.id ?? null,
    mainPhoto(record?.card?.photos ?? []),
  )

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
  const storageLabel = STORAGE_TYPES.find((t) => t.value === card.storage_type)?.label ?? '—'
  const conflicted = actions.conflictedIds?.includes(card.id)

  /* One stage control, one derivation. The legacy app showed the stage as a
     tracker strip AND a prev/next stepper; this rebuild had grown a third, a
     progress bar. They were the same fact stated three ways. */
  const stages = STAGES.map((s) => ({
    ...s,
    phase: stagePhase(card.status, s.key),
    selectable: canTransition(card.status, s.key),
  }))
  const progress = stageProgress(card.status)

  const received = card.received_items ?? []
  const authorized = (card.authorized_work ?? []).filter((w) => w.authorized)
  const conditionSummary = summarise(card.condition, SEED_CONDITIONS.length)
  const photos = card.photos ?? []
  const logs = card.logs ?? []

  return (
    <div>
      {!embedded ? (
        <TopBar
          title={card.work_order_no}
          onBack={onBack}
          actions={<IconButton icon="dots" label="More actions" />}
        />
      ) : null}

      {/* Conflict is a first-class state, not a toast. Both versions survive.
          The whole band is the way in: the worker reads "needs review" and taps
          the thing that said it, rather than a four-letter button at the end of
          the row. `Resolve` stays as the affordance, not as the hit area. */}
      {conflicted ? (
        <button
          type="button"
          className="offline-bar offline-bar--conflict offline-bar--action"
          onClick={actions.onResolveConflicts}
          aria-label="Needs review — this card changed on another device. Open the conflicts."
        >
          <Icon name="alert" size={18} />
          <span>Needs review — this card changed on another device</span>
          <span className="spacer" />
          <span className="offline-bar__cta">
            Resolve
            <Icon name="right" size={16} />
          </span>
        </button>
      ) : null}

      <header className="card-head" style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        {/* The boat's picture, quietly: the words on this block have to stay the
            darkest thing on the surface in both modes, so it is a watermark and
            not a hero. Decorative — it carries no alt text and takes no taps. */}
        {boatPhotoUrl ? <img className="card-head__photo" src={boatPhotoUrl} alt="" aria-hidden="true" /> : null}
        {card.is_scanned ? (
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <StatusPill tone="neutral" shape="square">
              Scanned
            </StatusPill>
          </div>
        ) : null}

        <h2 style={{ font: 'var(--headline-s)', marginTop: card.is_scanned ? 'var(--space-3)' : 0 }}>
          {boat?.name || boat?.model || 'Unnamed boat'}
        </h2>
        <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)' }}>
          {[customer?.name, boat?.motor_type, boat?.licence].filter(Boolean).join(' · ')}
        </p>
      </header>

      {/* The stage control is also the way forward and back. Legal targets are
          the only ones rendered as buttons, and legality lives in
          domain/cardStatus.js, not here. */}
      <StageStrip stages={stages} onSelect={(key) => actions.patch({ status: key })} />
      {/* The meter sits under the strip as the section rule. It restates what the
          strip already says in words, so it carries no text and no accessible
          role — see ui/ProgressMeter.jsx. */}
      {progress ? <ProgressMeter done={progress.done} total={progress.total} /> : null}

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

      <Collapsible
        title="Items received at intake"
        stateKey="card.items-received"
        count={received.length}
        summary={`${received.length} of ${SEED_RECEIVED_ITEMS.length} accounted for`}
      >
        <ReceivedItems
          items={SEED_RECEIVED_ITEMS}
          selected={received}
          onToggle={actions.toggleReceivedItem}
          onPhotograph={(item) => actions.capturePhoto({ photoType: 'received_item', caption: RECEIVED_LABELS[item] })}
        />
      </Collapsible>

      <Collapsible
        title="Authorized work"
        stateKey="card.authorized-work"
        count={authorized.length}
        summary={`${authorized.length} of ${SEED_AUTHORIZED_WORK.length} authorized`}
      >
        <AuthorizedWork
          work={(card.authorized_work ?? []).map((w) => ({
            ...w,
            key: w.key,
            label: SEED_AUTHORIZED_WORK.find((s) => s.key === w.key)?.label ?? w.key,
          }))}
          onToggleAuthorized={actions.toggleAuthorized}
          onToggleCompleted={actions.toggleCompleted}
        />
      </Collapsible>

      <Collapsible title="Condition assessment" stateKey="card.condition" summary={conditionSummary}>
        <ListItem
          icon="alert"
          title="Rate condition"
          support={conditionSummary}
          onClick={() => setConditionSheet(true)}
          trailing={<Icon name="right" size={20} />}
        />
      </Collapsible>

      <Collapsible title="Storage prep" stateKey="card.storage-prep" summary={card.wrap_required ? 'Wrapping required' : 'No wrap'}>
        <WrapControl wrapRequired={card.wrap_required} unwrapDone={card.unwrap_done} onChange={actions.patch} />
      </Collapsible>

      <Collapsible title="Photos" stateKey="card.photos" count={photos.length} summary={photos.length ? `${photos.length} on this card` : 'None yet'}>
        <PhotoStrip
          cardId={card.id}
          photos={photos}
          online={actions.online}
          onCapture={actions.capturePhoto}
          onDelete={actions.deletePhoto}
          onRetryUpload={actions.onRetryUpload}
        />
      </Collapsible>

      <Collapsible title="Work log" stateKey="card.work-log" count={logs.length} summary={logs.length ? `${logs.length} entries` : 'No entries yet'}>
        <LogList
          logs={logs}
          cardId={card.id}
          photos={photos}
          onAddPhoto={(log) => actions.capturePhoto({ photoType: 'work', workLogId: log.id })}
        />
        <LogComposer onSave={actions.addLog} onDirtyChange={onDirtyChange} />
      </Collapsible>

      <div style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {actions.onOpenInvoice ? (
          <Button variant="outlined" fullWidth icon="receipt" onClick={actions.onOpenInvoice}>
            Invoice
          </Button>
        ) : null}
        {actions.onOpenSchedule ? (
          <Button variant="outlined" fullWidth icon="calendar" onClick={actions.onOpenSchedule}>
            Schedule
          </Button>
        ) : null}
        <Button variant="text" fullWidth icon="qr" onClick={() => setQrSheet(true)}>
          Customer link
        </Button>
      </div>

      <CustomerQrSheet
        open={Boolean(qrSheet)}
        url={actions.customerUrl}
        name={customer?.name}
        boatName={boat?.name ?? boat?.model}
        workOrderNo={card.work_order_no}
        onDismiss={() => setQrSheet(false)}
        onCopy={actions.onCopyCustomerLink}
      />

      <Sheet open={conditionSheet} title="Condition assessment" onDismiss={() => setConditionSheet(false)}>
        <ConditionEditor
          areas={SEED_CONDITIONS}
          condition={card.condition}
          onRate={actions.rate}
          onNote={actions.note}
        />
        <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
          <Button fullWidth variant="tonal" onClick={() => setConditionSheet(false)}>
            Done
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
