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

Three things. None is optional. **The first two are enforced**: on MySQL the
server refuses to start and lists everything that is still wrong, because
`README` steps that get skipped on a deploy day are not steps.

1. **Set `APP_SECRET`.** Unset, the server signs tokens with a literal string
   that is in the repository. Anyone can mint a valid session. Nothing reads a
   `.env` file — set it in the shell, or in GoDaddy's environment settings.
2. **Change the admin PIN.** `1234` is seeded on first boot. There is no UI to
   change it yet — update the row in `mm_employees` (`pin_salt` / `pin_hash`) or
   add the admin screen. The boot check reads the stored hash, so it catches a
   PIN that was changed back.
3. **Delete `data/*.db` from any image or archive.** A dev SQLite file can
   contain real customer data.

### The database is shared with the legacy app

This app writes to `mm_`-prefixed tables (`DB_PREFIX`, default `mm_`). The legacy
tables alongside them are never read or written, which means rolling back is
"redeploy the old repo" and the old app keeps working throughout.

This matters because the two schemas share table *names*: `service_cards`,
`customers`, `photos` all exist in both, with different columns. Without the
prefix, `CREATE TABLE IF NOT EXISTS` would adopt the legacy shape rather than
create ours, and reads would quietly return legacy columns — a failure that
produces plausible data instead of an error.

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
the `mm_`-prefixed tables are missing, the database account lacked `CREATE`.

Then check the live build:

```
GET <site>/api/version
```

It reports the package version, the boot time, and — the part worth reading —
`dialect` and `prefix`. A wrong `prefix` means the app is reading the legacy
tables instead of ours, which looks like an empty database rather than an error.
Set `BUILD_ID` on the host if you want it to report a commit.

## Importing the legacy marina data

The legacy app's data migrates from its own export — one authenticated request to
`GET /api/export` on the old app returns a zip of `backup.sql` plus the photo
directory. Unzip it somewhere outside any repository: it is the only copy.

```
npm run import:legacy -- --dump <path>/backup.sql --photos <path>/photos
```

That is a dry run. It prints what would migrate, what is dropped, and what it
could not resolve, and writes nothing. Read that report before continuing.

To actually write, add `--apply`:

```
npm run import:legacy -- --dump <path>/backup.sql --photos <path>/photos \
  --uploads ./uploads --apply
```

Then read the result back the way a phone will:

```
npm run inspect:legacy
```

That walks card → boat → customer and parent → child through the sync protocol,
so a migration that wrote rows but attached a boat to the wrong card is caught.
It exits non-zero if anything dangles.

Notes worth knowing:

- **The dump is INSERT-only** — every statement names its columns, so the export
  is the authority on shape. The legacy repo's `schema.sql` is not; it describes
  the dev SQLite database, which differs from production.
- **Ids are rewritten.** Legacy integer ids become ULIDs and every foreign key
  is remapped, so nothing is left pointing at integer `7`. Ids are derived
  deterministically, which is what makes a half-finished run safe to repeat.
- **It refuses to run twice.** A second import would duplicate every row and
  leave two ids for the same customer's boat.
- **Migrated rows are `version 1, rev 0, device_id 'legacy'`**, and land in
  `change_log`, so a phone that has never seen the legacy app pulls them as
  ordinary history and can edit them without manufacturing a conflict.
- **Photos:** rows always import; files only where the export contained them. The
  report says how many, so a missing image is visible rather than a broken
  thumbnail. The legacy photo directory is copied, not moved, so rolling back
  still shows its photographs.

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