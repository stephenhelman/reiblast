# GHL ↔ Server Contract

Locked rules for every interaction between GoHighLevel (GHL) and this server.

## Rules

1. **GHL owns money and actions; the server owns interpretation and the record.**
   GHL collects payments through its processor, moves cards, and sends comms.
   The server determines what each payment means (new trial, third failed
   payment, recovery invoice that reactivates an account, etc.), keeps the
   billing record the dashboard reads from, decides state transitions, and
   performs only what GHL cannot do natively (e.g. SaaS pause/resume). The
   server never collects, approves, or reverses a GHL payment. The server's
   Stripe integration is REItools-only (run by OP Web Studio) and is out of
   scope for this contract.

2. **Server → GHL is intent only**, via GHL inbound-webhook workflows. The body
   carries `contactId` + a stage key or action (+ custom field values). No
   stage IDs, pipeline IDs, or opportunity IDs in server code.

3. **GHL → server is report-then-interpret.** GHL reports an event that has
   already happened; the payload carries identifiers. The server fetches the
   complete record by ID (webhook payloads lack the fields needed to
   classify), records it idempotently, then interprets it and decides any state
   change.

4. **One shared write path per state change.** Automated and manual triggers
   use the same function.

5. **Idempotency first.** Record the event before side effects; repeats are
   no-ops.

6. **Webhook routes always return 200.** Failures are logged/surfaced
   server-side, never signalled through the HTTP status.

7. **Lifecycle changes are pipeline stages; conditions are tags.** Exception:
   billing conditions (Payment Failed, Paused) are stages in the Active Client
   pipeline for visibility and native triggers.

## Stage keys

Stage keys equal `BillingState` enum values:

`trial`, `active`, `payment_failed`, `paused`, `inactive`, `churned`

## Stage-change webhooks: confirmation and command

A GHL "stage changed" webhook is both confirmation and command:

- If DB state **already matches** the stage, execute any pending side effect
  idempotently (e.g. a pause that was recorded but not yet applied).
- If DB state **does not match**, treat it as a manual action and apply it
  through the same write path as every other trigger (rule 4).
