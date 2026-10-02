# Marina Manager — agent instructions

Greenfield rebuild of the marina service-card app. Mobile-first, Material Design 3, **local-first / offline-capable**.

## Read these before writing any code

| Before | Read |
|---|---|
| Any work at all | `docs/architecture.md` |
| Sync, store, persistence, conflict work | `docs/behaviors-sync.md` |
| Auth, login, offline unlock, roles | `docs/behaviors-auth.md` |
| The unauthenticated QR card endpoint | `docs/behaviors-public-view.md` |

If code disagrees with a document, the code is wrong. If reality disagrees, **amend the document in the same change as the code** — never let the two drift.

## Non-negotiables

The numbered list in `architecture.md` §Non-Negotiable Constraints is binding. In short:

- Offline is the default assumption, not an error path. The phone holds the truth; the server is a peer.
- Screens are **stateless**. No `fetch`, no `indexedDB`, no `localStorage` in a screen.
- **No mirror rule.** Card status and card summary are computed in exactly one place. One call site, no duplicated logic in any consumer.
- **Every time-dependent function takes an explicit `now`.** Staleness, retention, GC, conflict age and token expiry are untestable otherwise.
- **Two real implementations or no interface.** One implementation means a plain module. This overrides generic "build engines behind ports" advice. Only three seams are justified: DB driver (SQLite/MySQL), auth (online/offline), sync transport.
- **No scattered booleans.** `isLoading` beside `isEditing` is a defect. Use the sealed state machines.
- Design tokens only. A literal hex, radius, or duration in a screen is a defect.
- Colour never carries meaning alone — pair it with a label and a shape.
- Light and dark are both first-class. Never derive one from the other by inversion.
- The card's field set mirrors the marina's **paper intake card**. Do not remove or rename fields because they look redundant. Workers know that form.
- Photos need signal. Data queues. Do not add an offline photo queue.
- Office and admin actions refuse offline. Do not "helpfully" queue them.
- Backwards compatibility is not a concern. **We are in beta** — write the correct schema, not a migration.
- Delete unused code. No speculative scaffolding.

## Roles

Exactly three: `admin`, `office`, `mechanic`. Old `cleaner`/`wrapper` are gone.

## Build order

Foundation → **Card detail as the reference screen → STOP FOR REVIEW** → remaining screens → sync + backend → audit.

Do not skip the review checkpoint. Do not start the backend before the local-first client works.

## While working

- Never look at more files than you need to. Skip verification for pure-docs edits.
- Minimal patches; don't rewrite whole files for small changes.
- Don't add comments unless asked.
- Reply short and direct: key points, bullet points, choices clearly. No long explanations, no pasted log dumps or data blobs — point to `file:line` instead.
- Update `architecture.md` §Module map in the same change as any new source file, so the docs never rot.

## Release gate

Accessibility and the M3 self-audit. Any `0` in component semantics, states & feedback, or accessibility blocks sign-off.

## Status

Beta.