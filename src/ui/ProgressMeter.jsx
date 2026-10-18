/*
 * The small horizontal progress bar.
 *
 * It receives only numbers (`done` / `total`) that a domain module already
 * decided, so it stays stateless and domain-free: no consumer computes its own
 * idea of progress.
 *
 * Decorative by default, deliberately. The bar under the stage strip restates a
 * fact that strip already names in words, so the bar is never the only place
 * its information lives and a `progressbar` role there would announce it twice.
 * `label` is for the other case: the marina's fill is an aggregate no other part
 * of the screen states, so with a label the number is text beside the bar and
 * the role goes with it.
 */
export default function ProgressMeter({ done, total, label, className = '' }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0
  const bar = (
    <span className="meter__track">
      <span className="meter__fill" style={{ width: `${pct}%` }} />
    </span>
  )

  if (!label) {
    return (
      <div className={`meter ${className}`.trim()} aria-hidden="true">
        {bar}
      </div>
    )
  }

  return (
    <div
      className={`meter meter--labelled ${className}`.trim()}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={Math.max(total, done)}
      aria-valuenow={done}
      aria-label={label}
    >
      {bar}
      <span className="meter__label" aria-hidden="true">
        {label}
      </span>
    </div>
  )
}
