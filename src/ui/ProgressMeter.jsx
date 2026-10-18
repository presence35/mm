/*
 * The small horizontal progress bar.
 *
 * It receives only numbers (`done` / `total`) that domain/cardStatus.js already
 * decided, so it stays stateless and domain-free: no consumer computes its own
 * idea of progress.
 *
 * Decorative, deliberately. The bar is the separator under the stage strip, and
 * the strip immediately above it already names the current stage and every
 * legal target — so the bar repeats a fact that is on screen in words. A
 * `progressbar` role here would announce the same thing a second time, and the
 * bar is never the only place its information lives.
 */
export default function ProgressMeter({ done, total, className = '' }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0
  return (
    <div className={`meter ${className}`.trim()} aria-hidden="true">
      <span className="meter__track">
        <span className="meter__fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}
