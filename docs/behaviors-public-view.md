# Behaviours — Public Customer View

**Status:** binding. Read before touching the unauthenticated QR card endpoint.

`GET /api/public/card/:token` is reached by scanning the QR code on the customer's copy of the service card. **It has no authentication by design** — that is the whole point. Which makes it a security surface, not a convenience.

## Non-Negotiable Constraints

1. **Narrow projection.** Only the fields in §Fields served. Never a whole row, never `SELECT *`.
2. **No internal data, ever.** Employee names, internal notes, `other_work`, condition assessments, and invoice line items are excluded — not filtered client-side, excluded from the query.
3. **Unguessable tokens.** 128 bits of entropy, generated server-side. Not a work-order number, not a sequential id, not a customer id.
4. **No enumeration.** A missing, revoked or unknown token returns an identical response to a valid one, with no timing or length difference.
5. **No caching of personal data.** `Cache-Control: no-store`. A shared or public machine must not retain a customer's details.
6. **Rate-limit by token and by source address.**
7. **Revocable.** A card can revoke its token. Revocation is instant and returns the same generic response as an unknown token.
8. **No write capability.** The public view is read-only. There is no public mutation path of any kind.

## `GET /api/public/card/:token`

```json
{
  "customer_name": "…",
  "boat": { "name": "…", "model": "…", "length_ft": 24 },
  "work_order_no": "…",
  "status_label": "IN STORAGE",
  "season_year": 2026,
  "services": [
    { "label": "Outdrive Svc", "authorized": true, "completed": true }
  ],
  "history": [ { "date": "…", "label": "…", "completed": true } ],
  "updated_at": "2026-10-02T14:03:11Z"
}
```

### Fields served

| Field | Source |
|---|---|
| `customer_name` | `customers.name` |
| `boat.name` / `.model` / `.length_ft` | `boats` |
| `work_order_no`, `season_year`, `status` | `service_cards` |
| `services[]` | `authorized_work` — label + authorized/completed flags only |
| `history[]` | `status_history` — date + status label only |

### Fields explicitly never served

`other_work` · `remarks` · `condition_assessment` (all rows) · `invoice_items` · `invoice_number` · `tax_rate` · any total or price · `photos` · `work_logs` (description or transcription) · `parts_used` · employee names, IDs or initials · `is_fake` · internal status before `intake` · GPS coordinates from photos

`other_work` deserves a specific note: it is free-text worker notes about *requested additional work*. It is on the paper intake card so the field exists, but it is internal deliberation, not a customer-facing commitment. It is never exposed here.

## Why this is its own document

The rest of the app's security surface is "who is logged in". This one is "a stranger holds a URL". Bounding it needs its own contract, its own review, and its own tests — folding it into the auth or sync documents would bury it.

## Failure modes

| Failure | Behaviour | Owner |
|---|---|---|
| Guessed or scanned wrong token | Generic "not found" — identical for unknown, revoked and malformed | public endpoint |
| Token revoked, link already printed | Instant generic response; nothing cached client-side beyond the session | public endpoint |
| Public URL shared or posted | Card details visible to the holder. `no-store` limits residue. This is accepted — the customer is meant to share it with their own eyes. | public endpoint |
| Card deleted | Token invalidated with the card tombstone; generic response | public endpoint |
| Rate limit hit | 429 with no detail about whether the token exists | public endpoint |
| A `fake` test card is scanned | `is_fake` cards serve a public projection too, marked `FAKE DATA`. Consider refusing issuance of a public token on fake cards. | public endpoint |

## Tests this surface requires

- Every field in §Fields served is present; every field in the exclusion list is absent from the response body.
- Unknown, revoked and malformed tokens produce byte-identical responses.
- Response headers include `Cache-Control: no-store`.
- A leaked token grants nothing beyond the projection — verified by fetching and diffing against the full card.

## Change log for this file

Adding a field to the public projection is a security change. It lands here first, explicitly, with the reason it is safe — never as a side effect of a query change elsewhere.