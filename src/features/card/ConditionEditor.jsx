import { Segmented, TextField } from '../../ui'
import { RATINGS, LABEL, needsNote } from './conditionModel.js'

/*
 * Condition, per area.
 *
 * Six independent questions, not a form. The previous layout answered that with
 * four chips per area — twenty-four controls in a column of near-identical
 * blocks, which is both tall and hard to compare down. Now: one row per area,
 * carrying its current state as text, above a single rating control.
 *
 * The correctness point, which does not depend on how often anyone rates
 * anything: "nobody checked" and "somebody checked and it is fine" are
 * different facts, and on a damage record only one of them is a pass. Three
 * unselected chips rendered both identically. Unrated now says "Not checked".
 *
 * Ratings are named states, not a magnitude, so this is a segmented radiogroup
 * and deliberately not a slider: a slider hides the four labels, invites
 * imprecise drags, and is hostile with gloves on. One tap per answer either
 * way — what changed is the twenty-four controls becoming six.
 *
 * Severity is echoed as a word on every row so all six can be read at a glance.
 * Colour reinforces it and is never the only signal.
 *
 * The rules live in conditionModel.js. This file only renders.
 */

const OPTIONS = RATINGS.map((r) => ({ value: r.value, label: r.label }))

const SEVERITY = {
  good: null,
  fair: 'var(--warning-container)',
  poor: 'var(--error-container)',
  damage: 'var(--error-container)',
}

const SEVERITY_TEXT = {
  fair: 'var(--on-warning-container)',
  poor: 'var(--on-error-container)',
  damage: 'var(--on-error-container)',
}

export default function ConditionEditor({ areas, condition, onRate, onNote }) {
  const byArea = Object.fromEntries((condition ?? []).map((c) => [c.area, c]))

  return (
    <section className="condition">
      {areas.map((a) => {
        const entry = byArea[a.key]
        const rating = entry?.rating ?? null
        const tint = rating ? SEVERITY[rating] : null

        return (
          <div key={a.key} className="condition__area">
            <div className="condition__head">
              <span className="condition__label">{a.label}</span>
              {rating ? (
                <span
                  className="condition__value"
                  style={tint ? { background: tint, color: SEVERITY_TEXT[rating] } : undefined}
                >
                  {LABEL[rating]}
                </span>
              ) : (
                <span className="condition__value condition__value--unset">Not checked</span>
              )}
            </div>

            <Segmented
              options={OPTIONS}
              value={rating}
              ariaLabel={`${a.label} condition`}
              /* Tapping the current rating clears it, so an accidental second
                 tap undoes rather than re-confirming. */
              onChange={(v) => onRate(a.key, v === rating ? null : v)}
            />

            {needsNote(rating) || entry?.note ? (
              <TextField
                label="What's wrong"
                value={entry?.note ?? ''}
                onChange={(value) => onNote?.(a.key, value)}
                placeholder="Scuff on starboard at waterline"
              />
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

/* Re-exported so screens and the editor share one source for the rules. */
export { summarise } from './conditionModel.js'