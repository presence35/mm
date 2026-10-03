# Marina Manager

Service and storage cards for a marina. Mobile-first, Material Design 3,
**local-first** — every read and every data write works with no signal.

The phone holds the truth. The server is a peer that eventually agrees.

## Read this first

| Document | What it is |
|---|---|
| `docs/architecture.md` | Binding contract: product, roles, IA, domain model, state machines, boundary rules, tokens, state matrix, failure modes, non-goals |
| `docs/behaviors-sync.md` | Sync protocol: row metadata, delta pull, idempotent push, conflicts, GC |
| `docs/behaviors-auth.md` | Auth: online session vs offline PIN, permission staleness |
| `docs/behaviors-public-view.md` | The unauthenticated QR card endpoint. A security surface — treat it as one |

Code that disagrees with these documents is wrong. Amend the document in the
same change, never let the two drift.

## Local development

```
npm install
npm run server          # API on :3000, SQLite in ./data/marina.db
npm run dev             # app on :5173, proxies /api to :3000
npm test                # 25 protocol + integration tests
```

Sign in with the seeded admin PIN: **1234**. It exists so a fresh install is
usable, and it is only acceptable locally — see below.

## Before this touches production

Three things. None is optional.

1. **Set `APP_SECRET`.** Unset, the server signs tokens with a literal string
   that is in the repository. Anyone can mint a valid session. Copy
   `.env.example` to `.env` and fill it in.
2. **Change the admin PIN.** `1234` is seeded on first boot. There is no UI to
   change it yet — update the row in `employees` (`pin_salt` / `pin_hash`) or
   add the admin screen.
3. **Delete `data/*.db` from any image or archive.** A dev SQLite file can
   contain real customer data.

## Deploying to GoDaddy

GoDaddy auto-builds and does **not** go live from a preview. The full sequence:

1. **Pull to Preview** — GoDaddy pulls the repo and builds the preview.
2. **Publish to Live** — promote the preview.
3. **Restart** — restart the Node app so route and schema bootstrap changes
   apply.

Skipping a step leaves production stale in a different way:

| Skipped | Symptom |
| --- | --- |
| No pull / no publish | Live serves the previous commit |
| No restart | New routes/tables missing; the client silently no-ops |
| Client cache not cleared | Installed PWA keeps serving the old precached bundle |

The client is an installed PWA. After deploying, on each device: **Setup →
Reinstall sample data is not the cache clear** — instead open the app, use the
service worker update prompt, or clear site data for the origin. Verify with
`<site>/api/version`-style checks against a route you just added.

Verify production MySQL by looking for `schema ensured` in the server logs. If
the `boat_serials` / sync tables are missing, the database account lacked
`CREATE`.

## Architecture notes

- **Screens are stateless.** They read the local store. They never call `fetch`
  and never touch IndexedDB.
- **Two state machines, one owner each.** `SyncProvider` owns connectivity,
  pending writes and conflicts. `AuthProvider` owns the session. A boolean
  flag shadowing either is a defect.
- **Two real implementations or no interface.** Only three seams qualify: the
  DB driver (SQLite/MySQL), auth (online/offline), sync transport.
- **Every time-dependent function takes an explicit `now`.** Otherwise
  staleness, retention and GC cannot be tested.
- **Conflicts keep both versions.** Nothing is silently overwritten, and a
  retry never double-applies.
- **Photos need signal; data does not.** Deliberate — see
  `docs/behaviors-sync.md` §Photos.