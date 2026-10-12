import Icon from './Icon'

/*
 * The stage strip — one ordered row of lifecycle stages.
 *
 * Stateless and domain-free on purpose. It receives stages that already carry
 * their `phase` and `selectable`, so the only place that decides what a phase
 * means, or which stages are legal targets, stays in domain/cardStatus.js
 * (architecture.md constraint 5, the no-mirror rule).
 *
 * Phase is never carried by colour alone. `done` gets a tick, `current` is the
 * only filled capsule and carries aria-current, `future` is outlined and
 * dimmed, and a skippable stage is drawn dashed — so a positional `done` on an
 * optional stage is not read as "this was performed".
 */

const PHASE_WORD = {
  done: 'done',
  current: 'current',
  future: 'not yet',
}

export default function StageStrip({ stages, onSelect }) {
  return (
    <ol className="stage-strip" aria-label="Card stage">
      {stages.map((s) => {
        const phase = s.phase ?? 'future'
        const selectable = Boolean(onSelect) && s.selectable !== false
        const Tag = selectable ? 'button' : 'span'
        const classes = [
          'stage',
          `stage--${phase}`,
          s.optional ? 'stage--optional' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <li key={s.key} className="stage-strip__item">
            <Tag
              className={classes}
              type={selectable ? 'button' : undefined}
              aria-current={phase === 'current' ? 'step' : undefined}
              aria-label={`${s.label}, ${PHASE_WORD[phase] ?? phase}${s.optional ? ', optional' : ''}`}
              onClick={selectable ? () => onSelect(s.key) : undefined}
            >
              {phase === 'done' ? (
                <Icon name="check" size={16} />
              ) : (
                <span className="stage__mark" aria-hidden="true" />
              )}
              <span className="stage__label">{s.label}</span>
            </Tag>
          </li>
        )
      })}
    </ol>
  )
}
