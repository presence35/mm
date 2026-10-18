import Icon from './Icon'
import { Sheet } from './Feedback'

/*
 * A filter, in a sheet.
 *
 * A row of chips could only show the handful that fit on one line, which is how
 * six chips came to stand in for nine stages. A sheet has room for the whole
 * set, and every option carries the same mark the row it matches carries — a
 * stage's dot shape — so two stages that share a tone are still told apart by
 * something other than colour.
 *
 * Stateless: the caller owns the options, the counts and the chosen value.
 * `count` is optional and is the "is this worth opening" answer the chips used
 * to give.
 */
export default function FilterSheet({
  open,
  title = 'Filter',
  options = [],
  value,
  onSelect,
  onDismiss,
}) {
  return (
    <Sheet open={open} title={title} onDismiss={onDismiss}>
      <div className="filter-list" role="radiogroup" aria-label={title}>
        {options.map((option) => {
          const chosen = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={chosen}
              className="filter-option"
              data-tone={option.tone ?? undefined}
              onClick={() => onSelect(option.value)}
            >
              {option.shape ? (
                <span className={`status-pill__dot status-pill__dot--${option.shape}`} />
              ) : (
                <span className="filter-option__mark" />
              )}
              <span className="filter-option__label">{option.label}</span>
              {typeof option.count === 'number' ? (
                <span className="filter-option__count">{option.count}</span>
              ) : null}
              {chosen ? <Icon name="check" size={20} /> : null}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
