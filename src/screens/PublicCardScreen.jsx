import { useState } from 'react'
import { StatusPill, EmptyState, Divider, KeyValue, Icon } from '../ui'
import * as store from '../engines/store/localStore.js'
import { statusMeta } from '../domain/cardStatus.js'
import { SEED_AUTHORIZED_WORK } from '../engines/store/seed.js'

/*
 * Public customer view — a separate security surface.
 *
 * Unauthenticated, reached by scanning the QR on the customer's copy of the
 * card. There is no app chrome, no navigation and no session.
 *
 * The projection below is the contract. docs/behaviors-public-view.md lists
 * what is NEVER served: employee names, internal notes, `other_work`,
 * condition assessments, invoice line items, photos, log entries, parts, and
 * GPS. Exclusion happens here, in the projection — never by filtering the
 * response after it is built.
 */

function project(card, boat, customer) {
  return {
    customer_name: customer?.name ?? null,
    boat: {
      name: boat?.name ?? null,
      model: boat?.model ?? null,
      length_ft: boat?.length_ft ?? null,
    },
    work_order_no: card.work_order_no,
    season_year: card.season_year,
    status_label: statusMeta(card.status).label,
    services: (card.authorized_work ?? []).map((w) => ({
      label: SEED_AUTHORIZED_WORK.find((s) => s.key === w.key)?.label ?? w.key,
      authorized: Boolean(w.authorized),
      completed: Boolean(w.completed),
    })),
    updated_at: card.updated_at ?? null,
  }
}

export default function PublicCardScreen({ token }) {
  const [record] = useState(() => {
    const card = store.cardByToken(token)
    if (!card) return null
    const full = store.getCard(card.id)
    return project(full.card, full.boat, full.customer)
  })

  // Unknown, revoked and malformed are indistinguishable on purpose: a
  // stranger holds this URL.
  if (!record) {
    return (
      <div className="app-shell">
        <main className="screen-body">
          <EmptyState
            icon="alert"
            title="Card not found"
            body="This link may have expired or been revoked. Ask the service desk for a new one."
          />
        </main>
      </div>
    )
  }

  const meta = statusMeta(record.status_label)

  return (
    <div className="app-shell">
      <main className="screen-body">
        <header style={{ padding: 'var(--space-6) var(--space-4) var(--space-4)', textAlign: 'center' }}>
          <p style={{ font: 'var(--label-m)', color: 'var(--on-surface-variant)' }}>
            {record.customer_name}
          </p>
          <h1 style={{ font: 'var(--headline-s)', marginTop: 'var(--space-1)' }}>
            {[record.boat.name, record.boat.model].filter(Boolean).join(' · ') || 'Your boat'}
          </h1>
          <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)' }}>
            {record.work_order_no} · {record.season_year}
            {record.boat.length_ft ? ` · ${record.boat.length_ft} ft` : ''}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-3)' }}>
            <StatusPill tone={meta.tone} shape={meta.shape}>
              {record.status_label}
            </StatusPill>
          </div>
        </header>

        <Divider />

        <div className="section-head">Your service</div>
        {!record.services.length ? (
          <EmptyState icon="receipt" title="Nothing scheduled yet" body="Work is added here once it has been agreed." />
        ) : (
          <div style={{ display: 'grid', gap: 0 }}>
            {record.services.map((s) => (
              <div
                key={s.label}
                className="list-item"
                style={{ cursor: 'default' }}
              >
                <span className="list-item__leading">
                  <Icon name={s.completed ? 'check' : s.authorized ? 'wrench' : 'alert'} size={22} />
                </span>
                <span className="list-item__text">
                  <span className="list-item__title">{s.label}</span>
                  <span className="list-item__support">
                    {s.completed ? 'Completed' : s.authorized ? 'Booked in' : 'Not agreed'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <Divider />

        <div className="section-head">Questions?</div>
        <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-6)' }}>
          Contact the service desk at the marina and quote your work order number.
        </p>

        <KeyValue rows={[]} />
      </main>
    </div>
  )
}