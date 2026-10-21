# REIblast Discord bot ↔ server contract — verification (step 1)

Server side of the Verify flow: two endpoints the bot calls to link a Discord account to a REIblast member, plus the unlink endpoint
(below). (Revoke is in `docs/revoke-contract.md`; the keep list is a later step.)

## Common to both endpoints

| | |
|---|---|
| Method / URL | `POST https://<app host>/api/discord/verify/start` and `/api/discord/verify/confirm` |
| Auth header | `x-reiblast-discord-secret: <value of DISCORD_BOT_INBOUND_SECRET>` (compared timing-safe) |
| Body | JSON object, `Content-Type: application/json` |
| HTTP status | **Always 200.** Read `result` and `reason`; never branch on the status code. |
| Response | `{ "result": "...", "reason": "...", ...extra }` |

`result` is one of `code_sent`, `linked`, `refused`, `error`. `reason` is always present.

### Identifying the member

Send `discordUserId` plus **exactly one** of:

- `email` — the **signup (purchase) email**, not the business email. The server lowercases and trims it.
- `locationId` — the GHL location id (fallback).

`discordUserId` is the Discord snowflake as a **string** (15–25 digits). Both identifiers, neither, a non-string, or a malformed value
returns `bad_request`.

## `POST /api/discord/verify/start`

Resolves the member, checks eligibility and link conflicts, and texts a 6-digit code (valid 10 minutes) to the personal phone on the
member's HQ contact.

Request:

```json
{ "discordUserId": "123456789012345678", "email": "member@example.com" }
```

or `{ "discordUserId": "...", "locationId": "..." }`.

| Response | When |
|---|---|
| `{ "result": "code_sent", "reason": "code_sent", "phoneLast4": "1234" }` | Code sent. Show the last 4 digits. |
| `{ "result": "linked", "reason": "linked" }` | This member is already linked to **this** Discord account. No code needed — go straight to the rules step. |
| `{ "result": "refused", "reason": "already_linked" }` | The member is linked to a different Discord account, or this Discord account is linked to a different member. |
| `{ "result": "refused", "reason": "not_eligible" }` | No such account **or** not eligible (onboarding form not done, suspended/inactive, internal or test account). The two are deliberately indistinguishable. |
| `{ "result": "refused", "reason": "rate_limited" }` | Over a limit (below) or a code was sent less than 60 seconds ago. |
| `{ "result": "refused", "reason": "delivery_failed" }` | Eligible, but the phone lookup or the SMS send failed. |

Limits (rolling hour, counted from the database): **5 starts per Discord account**, **3 starts per member**. Plus a 60-second
cooldown between sends to the same member.

## `POST /api/discord/verify/confirm`

Checks the code and creates the link. Safe to repeat.

Request — the same identifier as the start call, plus the code:

```json
{ "discordUserId": "123456789012345678", "email": "member@example.com", "code": "123456" }
```

`code` must be a 6-digit string; anything else is `bad_request`.

| Response | When |
|---|---|
| `{ "result": "linked", "reason": "linked" }` | Linked. Also returned if this exact pair was already linked (idempotent — no live code needed). |
| `{ "result": "refused", "reason": "invalid_code", "attemptsRemaining": 2 }` | Wrong code. |
| `{ "result": "refused", "reason": "invalid_code" }` | **No `attemptsRemaining`:** there is no code sent to this Discord account for this member in the last 10 minutes. Treat as "start over". |
| `{ "result": "refused", "reason": "code_expired" }` | The code expired (or was already used). |
| `{ "result": "refused", "reason": "code_locked" }` | 3 wrong attempts on this code. |
| `{ "result": "refused", "reason": "already_linked" }` | Linked elsewhere (another Discord account for this member, or this Discord account to another member), including losing a race. |
| `{ "result": "refused", "reason": "not_eligible" }` | Same meaning as in start; eligibility is re-checked at confirm. |
| `{ "result": "refused", "reason": "rate_limited" }` | More than 10 confirms per Discord account in the hour. |

A code only works for the Discord account and member it was sent for, and only for a code sent by the Discord start call. Codes from
other REIblast flows (tools, onboarding) are rejected.

## `POST /api/discord/unlink`

Same URL host, auth header (`x-reiblast-discord-secret`), body rules and always-200 behavior as the verify endpoints.

```json
{ "discordUserId": "123456789012345678" }
```

`discordUserId` is the Discord snowflake as a **string** (15–25 digits); anything else is `bad_request`. Other keys are ignored.

| `result` | `reason` | Meaning | Bot action |
|---|---|---|---|
| `unlinked` | `unlinked` | The link existed and is deleted. | Remove the role yourself. |
| `not_linked` | `not_linked` | No link for this Discord account (already unlinked, or never linked). | Same — treat as done; safe to repeat. |

Unlink is **idempotent**. The server queues no revoke: the bot removes the role itself once this answers, so the server never calls
`/revoke` for an unlink. Afterwards the member can verify again, and the Discord account can link to a member again. The errors below apply.

## Errors (all endpoints)

`{ "result": "error", "reason": "..." }`

| `reason` | Meaning | Bot action |
|---|---|---|
| `auth_missing` | No secret header. | Config bug. Alert staff. |
| `auth_failed` | Wrong secret. | Config bug. Alert staff. |
| `server_misconfigured` | `DISCORD_BOT_INBOUND_SECRET` is unset on the server. | Alert staff. |
| `bad_json` | Body is not a JSON object. | Bug. Alert staff. |
| `bad_request` | Body failed validation. | Bug if the bot built it; otherwise ask the user to re-enter. |
| `internal_error` | Unexpected server error. | Ask the user to try again later. |

## Reason codes at a glance

| `reason` | `result` | Endpoint(s) |
|---|---|---|
| `code_sent` | `code_sent` | start |
| `linked` | `linked` | start, confirm |
| `already_linked` | `refused` | start, confirm |
| `not_eligible` | `refused` | start, confirm |
| `rate_limited` | `refused` | start, confirm |
| `delivery_failed` | `refused` | start |
| `invalid_code` | `refused` | confirm |
| `code_expired` | `refused` | confirm |
| `code_locked` | `refused` | confirm |
| `unlinked` | `unlinked` | unlink |
| `not_linked` | `not_linked` | unlink |
| `bad_request`, `bad_json`, `auth_missing`, `auth_failed`, `server_misconfigured`, `internal_error` | `error` | all |

## Bot UX rules

These are requirements, not suggestions. They exist so the Verify button can't be used to find out which emails belong to customers.

1. **One identical message for `not_eligible`, `already_linked` and `rate_limited`.** Same text, same formatting, same buttons, same
   timing (don't add delays or extra steps to one of them). The message tells the user to **text the REIblast support number** —
   unverified users can't see the support channels. Example: *"We couldn't verify you automatically. Text the REIblast support number
   and we'll sort it out."* Never say which of the three happened.
2. **Include `delivery_failed` in that same message.** It only occurs for real, eligible accounts, so showing it differently would
   reveal that the email is a customer. (Texting support is also the right next step for a persistent failure.)
3. **`invalid_code`:** if `attemptsRemaining` is present, show it ("Incorrect code — 2 attempts left"). If it is absent, treat it like
   `code_expired`: tell them to start over.
4. **`code_expired` / `code_locked`:** tell them to start over (press Verify again to get a new code).
5. **`code_sent`:** show only `phoneLast4` ("We sent a code to the phone ending in 1234") and an **Enter Code** button. Never echo
   the email the user typed back in a way that confirms it matched.
6. **Only call confirm for a session that just got `code_sent`**, reusing the identifier from that start call. Don't offer a standalone
   "enter code" path that takes a fresh email — confirm answers differently for real and unknown accounts.
7. **`linked`** (from either endpoint) → show the rules + "I agree" step, then grant the role.
8. Keep everything **ephemeral**. Don't log or persist emails, codes or phone digits in the bot. Log reason codes only.
9. Treat `auth_*`, `server_misconfigured`, `bad_json` and `bad_request` as bugs: alert staff, show the user a generic "try again later".

## Server-side notes (for reference)

- Eligibility = `User.status` in `onboarding_complete` / `provisioning` / `active`, `GhlAccount.accountType = member`, and a contact
  id not starting with `test_`. Anything else fails closed. (The billing engine is in shadow mode, so `User.status` is the source.)
- A location id that disagrees between `GhlAccount.locationId` and `User.ghlLocationId` (or matches two accounts) is treated as not
  found.
- The link is stored in `DiscordLink` (unique on both `ghlAccountId` and `discordUserId`). Attempts are logged in
  `DiscordVerifyAttempt`; both tables are registered in `lib/admin/removeMembers.ts`.
