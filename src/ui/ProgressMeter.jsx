/*
 * The small horizontal progress bar — the lifecycle in one line.
 *
 * The third telling of the stage fact, beside the StatusPill and the
 * StageStrip. It receives only numbers (`done` / `total`) that
 * domain/cardStatus.js already decided, so it stays stateless and domain-free:
 * no consumer computes its own idea of progress.
 *
 * Least-privileges on the word, too: colour never carries meaning alone, so
 * the fill is paired with "4 of 9" text and the whole element reads out with
 * role="progressbar" the same way.
 */
export default function ProgressMeter({ done, total, label = 'Stage progress', className = '' }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0
  return (
    <div
      className={`meter ${className}`.trim()}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={label}
    >
      <span className="meter__track" aria-hidden="true">
        <span className="meter__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="meter__word">
        {done} of {total}
      </span>
    </div>
  )
}
