/*
 * The marina's physical grid: buildings by row and column, boathouses by slip.
 *
 * Stateless. It is handed cells and draws them — it does not know what a storage
 * type is, does not read the store and does not decide which boat is where. That
 * rule lives in domain/storageLocation.js, so the grid and the list can never
 * disagree about who is in Metal 2 row 3.
 *
 * A table, not a div soup: the headers are a column or a row a screen reader
 * can pair with a cell, and a cell that holds a boat is a real button. Empty
 * cells are not focusable — there is nothing to activate, and 130 tab stops of
 * empty boxes would be a worse keyboard experience than no grid at all.
 *
/*
 * Colour is never the only signal. Every occupied cell carries the boat's name
 * and — for a screen reader — the stage in words. The mark is a plain dot: the
 * stages are told apart by their name and their position in the order, not by
 * nine glyphs nobody could learn. Vacant cells that the layout describes carry
 * their size class's own shape, which is a list of three, not nine.
 */

function Cell({ cell, onSelect }) {
  const { text, label, tone, shape, card } = cell

  /* Vacant, but the layout knows this spot: showing its size class is the whole
     point of recording dimensions. Drawn as a dimmed chip, never as a button. */
  if (!card) {
    return (
      <td className="slot-cell">
        <span className={`slot slot--vacant ${tone ? `slot--${tone}` : ''}`.trim()}>
          {shape ? <span className={`status-pill__dot status-pill__dot--${shape}`} /> : null}
          <span className="sr-only">{label}</span>
        </span>
      </td>
    )
  }

  return (
    <td className="slot-cell">
      <button type="button" className={`slot slot--${tone}`} aria-label={label} onClick={() => onSelect?.(card)}>
        <span className="status-pill__dot" />
        <span className="slot__text" aria-hidden="true">
          {text}
        </span>
      </button>
    </td>
  )
}

export default function SlotGrid({ caption, columns = [], rows = [], onSelect }) {
  return (
    <div className="slot-grid__scroll">
      <table className="slot-grid">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th className="slot-grid__corner" />
            {columns.map((c) => (
              <th key={c} scope="col" className="slot-grid__head">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="slot-grid__head">
                {row.label}
              </th>
              {row.cells.map((cell) => (
                <Cell key={cell.key} cell={cell} onSelect={onSelect} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
