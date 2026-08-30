# Payment Dunning Webhook System

Two GHL webhooks drive payment-failure dunning. The server is the single
source of truth for pipeline moves — it calls `moveToStage()` directly;
GHL workflows do not decide moves and should stay dumb triggers.

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
- On first failure since the last reset (`wasZero`), the route itself calls
  `moveToStage(contactId, "Failed Payment", ...)`.
- At `warningCount >= 3` ("threshold"), the route itself calls
  `moveToStage(contactId, "Paused", ...)` instead. That opportunity move is
  what fires the `pause` webhook below — GHL doesn't decide to pause on its
  own, it's just relaying a stage-change trigger the server caused.
- Returns `{ action: "reset" | "none" | "warn" | "threshold", warningCount, wasZero }`
  for observability/debugging — GHL automations should not branch on this
  response since the server has already made every move it's going to make.

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

Both routes do all of their work synchronously before responding — no
background jobs or post-response processing.

## Pipeline stages

- **Failed Payment** — display only. No GHL triggers/automations live on
  this stage; it exists so staff can see who's in a failing-payment state.
  The server moves a contact here on their first unresolved failure.
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

## The server dictates all pipeline moves

`payment-failed` calls `moveToStage()` directly for both Failed Payment and
Paused — GHL never decides a move on its own. This keeps the dedupe,
wallet-balance, and warning-counting logic in one place instead of split
across app code and GHL workflow conditions, and it means there's no
GHL-side state (a synced custom field, a workflow counter) that could drift
from `User.warningCount` in the database. `pause` is a second, separate
webhook rather than something `payment-failed` calls inline, so that a
contact manually moved to Paused by an admin — with no billing failure
involved — still goes through the same suspension path.
