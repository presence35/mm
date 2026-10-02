# Behaviours — Auth Engine

**Status:** binding. Read before any auth, login, offline-unlock, or role work.

Two implementations exist here, which is why this is an engine and not a module: an **online session** and an **offline local PIN**. They are genuinely different flows with different failure modes, not one flow behind a flag.

## Non-Negotiable Constraints

1. **PIN hashes never leave the server.** Not in any sync payload, not in reference data, not in a log.
2. **Offline unlock is entirely client-side.** It never contacts the server. It requires a prior successful login *and* a local PIN gate.
3. **Explicit `now`.** Token expiry and permission-snapshot staleness take the current time as a parameter.
4. **Re-validate on every reconnect.** A cached permission snapshot is never trusted across a reconnection.
5. **Office and admin actions do not queue offline.** They refuse with a stated reason. This is the whole reason the two-implementation split exists — see §Permission staleness.
6. **Permission checks live in one place.** `auth/permissions.js`. No screen or engine re-derives a capability from a role string.
7. **Rate-limit login.** Per employee and per source address.

## State machine

`AuthProvider` owns this. UI reads it and never derives auth state itself.

```
anonymous ──pin online──▶ online ──token expired──▶ expired
                              │                         │
                              ├──network lost──▶ unlocked (local pin)
                              └──logout────────▶ anonymous
```

| State | Means | Cached permissions |
|---|---|---|
| `anonymous` | No session. Nothing is readable or writable. | none |
| `online` | Server-validated session with a live token. | server-authoritative, no expiry |
| `unlocked` | Local PIN gate passed. No validated session. | snapshot + expiry, re-validated on reconnect |
| `expired` | Session existed but could not be refreshed while online. | stale — shown but not trusted for gated actions |

`unlocked` is the state that matters in the field: a mechanic at the dock with no signal, working from cached data, with `unlocked` permissions.

## Online session

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login` | PIN → JWT + employee record |
| `GET /api/auth/me` | Validate token, return fresh role and permissions |

PINs are hashed with a per-employee salt. Constant-time comparison. Failed attempts are counted per employee and per source address, with backoff.

The permission snapshot is what `unlocked` reads. It is written on every successful login and every `/auth/me` validation, and carries an expiry.

## Offline unlock

Client-side only:

1. Requires at least one prior successful login on this device.
2. Requires the local PIN gate.
3. Grants `unlocked` with the cached permission snapshot.
4. Sets an expiry on that snapshot. Reaching it forces a re-unlock.

**Not** biometrics. WebAuthn degrades to "must be online" on devices without a platform authenticator, which is exactly the failure this app cannot afford. A PIN always works.

The threat model is a stolen phone, not a determined attacker — but the realistic threat is *unattended access*, so the gate is short and local.

## Permission staleness

An employee demoted from `admin` to `mechanic` while a phone is offline keeps admin rights on that phone until it reconnects. Two things bound this:

- The permission snapshot is re-validated on every successful reconnect, so the window is bounded by offline duration.
- **`admin`- and `office`-gated actions never queue offline.** They refuse immediately with a reason. Queuing an invoicing action under stale permissions is the worst case in the app.

Consequence, accepted deliberately: an admin cannot invoice from a dead spot.

## Roles

Exactly three.

| Role | Capabilities |
|---|---|
| `admin` | Everything: employees, catalogue, templates, backup. |
| `office` | Create/edit customers, boats, cards. Build and issue invoices. No employees, no catalogue. |
| `mechanic` | Work on cards: tasks, checklists, condition, logs, photos. No customer creation, no invoicing, no Setup. |

The old `constants.js` defined five (`cleaner`, `wrapper`). Those are gone — cleaning and wrapping are *tasks on a card*, not jobs someone holds.

`permissions.js` maps role → capability set. A screen asks "may I do X", never "what is my role".

## Failure modes

| Failure | Behaviour | Owner |
|---|---|---|
| No signal at shift start | `online` → `unlocked` on local PIN, if a cached snapshot exists. Otherwise `anonymous`, stated plainly. | auth engine |
| Token expires mid-shift | Drops to `unlocked` if a cached snapshot exists, else `expired` with a reason. Work in progress stays queued, never lost. | auth engine |
| Device wiped, no session | `anonymous`. Requires a real login, which requires signal. Nothing is silently granted. | auth engine |
| Employee deactivated remotely | Not learned until reconnect. Deactivation also revokes the device via `sync_devices.revoked_at`. | auth engine |
| Snapshot expiry reached offline | Forces re-unlock with the local PIN. Snapshot is not extended silently. | auth engine |
| Role changed offline | Cannot happen — roles are server-owned reference data and require a sync to arrive. | sync engine |

## Change log for this file

Changes to endpoints, role capabilities, snapshot lifetime or offline-unlock behaviour land here before code, on both sides.