import { Chip, ChipRow } from '../../ui'

const RATINGS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damage', label: 'Damage' },
]

const LABEL = Object.fromEntries(RATINGS.map((r) => [r.value, r.label]))

/* Per-area condition rating. Chips are the correct control here: mutually
   exclusive selection among a small set. Colour is never the only signal —
   the selected chip shows a check and carries the label. */
export default function ConditionEditor({ areas, condition, onRate, onNote }) {
  const byArea = Object.fromEntries((condition ?? []).map((c) => [c.area, c]))

  return (
    <section>
      <div className="section-head">Condition assessment</div>
      {areas.map((a) => {
        const entry = byArea[a.key]
        return (
          <div key={a.key} style={{ padding: '0 var(--space-4) var(--space-4)' }}>
            <p style={{ font: 'var(--title-s)', color: 'var(--on-surface)' }}>{a.label}</p>
            <ChipRow>
              {RATINGS.map((r) => (
                <Chip
                  key={r.value}
                  selected={entry?.rating === r.value}
                  onClick={() => onRate(a.key, entry?.rating === r.value ? null : r.value)}
                >
                  {r.label}
                </Chip>
              ))}
            </ChipRow>
            {entry?.note ? (
              <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', marginTop: 'var(--space-2)' }}>
                {entry.note}
              </p>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

export function ratingLabel(value) {
  return LABEL[value] ?? null
}