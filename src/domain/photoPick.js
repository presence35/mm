/*
 * Which photo stands for a card.
 *
 * The card header draws the boat's picture behind its opening lines, and a
 * later "main picture" flag will want the same answer. One derivation, because
 * two would eventually disagree about which image is THE image.
 *
 * Intake wins: what a boat looked like when it arrived is what a person means
 * by "the picture of this boat", and it is the one photo somebody always takes.
 * Failing that, the most recent, because that is the freshest evidence of what
 * the boat looks like now. Rows carry no timestamp when the legacy import could
 * not supply one, so the tie-break is by id and the order is total — the same
 * list must always pick the same photo.
 */

export const MAIN_PHOTO_TYPE = 'intake'

function newer(a, b) {
  const at = String(a?.uploaded_at ?? '')
  const bt = String(b?.uploaded_at ?? '')
  if (at !== bt) return at > bt ? a : b
  const ai = String(a?.id ?? a?.filename ?? '')
  const bi = String(b?.id ?? b?.filename ?? '')
  return bi > ai ? b : a
}

export function mainPhoto(photos) {
  const rows = (photos ?? []).filter((p) => p && p.filename)
  if (!rows.length) return null
  const intake = rows.filter((p) => (p.photo_type ?? 'general') === MAIN_PHOTO_TYPE)
  return (intake.length ? intake : rows).reduce(newer)
}
