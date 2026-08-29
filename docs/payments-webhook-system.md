# Payment Dunning Webhook System

Two GHL webhooks drive payment-failure dunning. The server is the single
source of truth for pipeline moves — GHL workflows react to the `action`
field returned by the webhook; they do not decide moves themselves.

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
- Returns `{ action: "reset" | "none" | "warn" | "threshold", warningCount, wasZero }`.
  `wasZero` is true when this was the user's first failure since their last
  reset — the GHL workflow uses it to move the contact into **Failed
  Payment** on first failure. `action: "threshold"` (warningCount >= 3)
  moves the contact into **Paused**.

### `POST /api/webhooks/ghl/pause`

Fires when a contact is moved to the Paused pipeline stage — either by the
dunning workflow (billing) or manually by an admin (non-billing).

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
- **Paused** — the killswitch. A contact here has had their GHL location
  paused via `pauseLocation()` and their `User.status` set to `suspended`.

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

Neither webhook moves the GHL pipeline stage itself. Each returns an
`action` (and, for payment-failed, `wasZero`/`warningCount`) that the GHL
workflow reads to decide whether to move the contact to Failed Payment or
Paused. This keeps the actual business logic (dedupe, wallet checks,
warning counting, suspension gating) in the app rather than duplicated in
GHL workflow conditions.
