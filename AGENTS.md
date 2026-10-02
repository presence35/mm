# Marina Manager — agent instructions

Greenfield rebuild of the marina service-card app. Mobile-first, Material Design 3, **local-first / offline-capable**.

## Read these before writing any code

1. `docs/architecture.md` — **binding contract.** Product, roles, IA, domain model, state machines, boundary rules, design tokens, state matrix, non-goals.
2. `docs/api-contract.md` — **binding contract.** Sync protocol, row metadata, conflict semantics, GC rules, auth, public endpoint.

If code disagrees with either document, the code is wrong. If reality disagrees with either document, amend the document first, then fix the code. Never let the two drift.

## Non-negotiables

- Offline is the default assumption, not an error path. The phone holds the truth; the server is a peer.
- Screens are **stateless presentational components**. No `fetch`, no `indexedDB`, no `localStorage` inside a screen.
- **An abstraction needs two real implementations.** One implementation means no interface — just a module. This overrides the generic "build engines behind ports" advice and the `web-app-builder` skill's abstractions-by-default habits. Only three seams are justified: DB driver (SQLite/MySQL), auth (online/offline), sync transport.
- **No scattered booleans.** `isLoading`, `isEditing`, `hasFetched` alongside each other is a defect. Use the sealed state machines in `architecture.md` §5.
- Design tokens only. A literal hex, radius, or duration inside a screen is a defect.
- Colour never carries meaning alone — pair it with a label and a shape.
- Light and dark are both first-class. Never ship one as an afterthought.
- The card's field set mirrors the marina's **paper intake card**. Do not remove or rename fields because they look redundant. Workers know that form.
- Photos need signal. Data queues. Do not "improve" this by adding an offline photo queue.
- Delete unused code. No speculative scaffolding.

## Roles

Exactly three: `admin`, `office`, `mechanic`. Old `cleaner`/`wrapper` roles are gone.

## Build order

Foundation → **Card detail as reference screen → STOP FOR REVIEW** → remaining screens → sync + backend → audit.

Do not skip the review checkpoint. Do not start the backend before the local-first client works.

## Release gate

Accessibility and the M3 self-audit. Any `0` in component semantics, states & feedback, or accessibility blocks sign-off.

## Status

Beta.