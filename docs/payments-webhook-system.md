# Payment Dunning Webhook System

Three GHL webhooks drive payment-failure dunning. GHL owns the move into
Failed Payment on its own (via its own workflow on the raw payment-failed
event) — the app doesn't touch that stage. The server is the sole authority
for the one move that actually matters operationally: it calls
`moveToStage()` into Paused directly once `warningCount` hits 3, rather
than relying on a GHL workflow to track the count and decide when to pause.

## Routes

### `POST /api/webhooks/ghl/payment-failed`

Fires on a GHL payment event (both failure and success, distinguished by
`customData.payment_status`).

- Resolves the `User` by `email`.
- **Success** (`payment_status === "success"`): resets `warningCount` to 0
  and removes the `payment_failed` tag from the contact. Does not touch
  `status`.
- **Failure**: dedupes on `Transaction.dedupeKey` (the GHL `transaction_id`,
  or a stable hash of `locationId|amountCents|YYYY-MM` when absent). A
  duplicate delivery is a no-op 200. Checks the location's wallet balance —
  if it's `>= 0` the failure was already covered elsewhere and nothing
  happens. If the balance is negative, the `payment_failed` tag is added
  and `warningCount` is incremented.
- `wasZero` (this was the user's first failure since their last reset) is
  returned for observability only — the route does not move the opportunity
  on it. GHL's own workflow handles the move into Failed Payment.
- At `warningCount >= 3` ("threshold"), the route itself calls
  `moveToStage(contactId, "Paused", ...)`. That opportunity move is what
  fires the `pause` webhook below — GHL doesn't decide to pause on its own,
  it's just relaying a stage-change trigger the server caused.
- Returns `{ action: "reset" | "none" | "warn" | "threshold", warningCount, wasZero }`
  for observability/debugging.

### `POST /api/webhooks/ghl/pause`

Fires when a contact is moved to the Paused pipeline stage — either by the
`payment-failed` route above (billing, at the warning threshold) or
manually by an admin moving the opportunity themselves (non-billing).

- Resolves the `User` by `email`. No-op if already `suspended`.
- **Tag-routed guard**: if the contact's `tags` include `payment_failed`,
  this is a billing pause — it only proceeds if `getWalletBalance() < 0`.
  If the balance is `>= 0` (the client topped up after being tagged but
  before the pause fired), it returns `{ action: "none" }` and does
  nothing. If the tag is absent, this is a manual/non-billing pause and
  proceeds unconditionally with no wallet check.
- On proceeding: calls `pauseLocation()` and sets `user.status = "suspended"`.
- Returns `{ action: "none" | "paused" }`.

### `POST /api/webhooks/ghl/active`

Fires when an opportunity is moved to the Active pipeline stage — the
reactivation path, whether the account is coming back from a billing pause
or being manually reactivated by an admin.

- Resolves the `User` by `email`. No-op if no user found.
- If `warningCount > 0`: resets it to 0. Does not touch GHL tags — the
  active-stage automation already strips all tags and re-adds the
  appropriate ones for that stage, so this route doesn't need to (and
  shouldn't) manage `payment_failed` itself here.
- If `status === "suspended"`: calls `unpauseLocation()` (same `/saas/pause`
  endpoint as `pauseLocation()`, with `paused: false`) to un-pause the
  sub-account.
- Always sets `user.status = "active"`.
- Returns `{ action: "activated", hadWarnings, wasSuspended }`.

All three routes do their work synchronously before responding — no
background jobs or post-response processing.

## Pipeline stages

- **Failed Payment** — display only. No app code moves a contact here;
  GHL's own workflow handles it directly off the raw payment-failed event.
  Staff use it to see who's in a failing-payment state.
- **Paused** — the trigger for the killswitch. The server moves a contact
  here once `warningCount` hits 3 with a still-negative wallet balance;
  the move itself is what fires `pause`, which calls `pauseLocation()` and
  sets `User.status = "suspended"`.

## Tag lifecycle

The `payment_failed` tag mirrors `User.warningCount` exactly:

- **Added** on the first *confirmed* billing failure (wallet balance
  negative) in `payment-failed`.
- **Removed** on a confirmed successful payment in `payment-failed`.

Keeping the tag in lockstep with `warningCount` matters because the pause
route's tag-routed guard uses the tag's presence to decide whether a pause
is billing-related. A stale tag left over from a prior failure would
wrongly force the wallet-balance gate onto a later manual/non-billing
pause.

## The server dictates the Paused move

`payment-failed` calls `moveToStage()` directly into Paused once
`warningCount` hits 3 — GHL never tracks the warning count itself or
decides when to pause. This keeps the dedupe, wallet-balance, and
warning-counting logic in one place instead of split across app code and a
GHL workflow condition, and it means there's no GHL-side state (a synced
custom field, a workflow counter) that could drift from `User.warningCount`
in the database. `pause` is a second, separate webhook rather than
something `payment-failed` calls inline, so that a contact manually moved
to Paused by an admin — with no billing failure involved — still goes
through the same suspension path.
