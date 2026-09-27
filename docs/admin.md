# REIblast admin

Owner-only billing dashboard for REIblast money (collected through GHL and its processors). **Entirely separate from the
REItools admin** (Stripe / OP Web Studio): no shared models, routes or libs. There are no role checks anywhere — access is
"you can prove control of the internal owner account".

## Host routing (`middleware.ts`, `lib/admin/hostRouting.ts`)

| Host | Behavior |
|---|---|
| `admin.reiblast.app` | Everything is rewritten under `/admin/*`. `/login` and `/enter` are public; every other path needs a valid session cookie, else redirect to `/login`. |
| `admin.localhost[:port]` (dev) | Same as the admin host. Browsers resolve `*.localhost` to loopback: `npm run dev` then open `http://admin.localhost:3000/login`. Cookie is not `Secure` on this host only (Safari drops Secure cookies on localhost). |
| Vercel **preview** with `ADMIN_PATH_ACCESS=true` | `/admin/*` is served by path on the preview host (`/admin/enter`, `/admin/login`, …). Requires `VERCEL_ENV === "preview"`. |
| Marketing / tools hosts, and production in every other case | Any `/admin` path returns **404**. |

Middleware sets an `x-admin-base` request header (`""` or `/admin`) so links and redirects work in both modes, and
`X-Robots-Tag: noindex`. Middleware runs on the edge and only checks the JWT signature; it is not the authority.

**`/api` is not matched by middleware.** Every `/api/admin/*` handler must start with
`const r = await ownerOr401(req); if (r instanceof NextResponse) return r;` (`lib/admin/requireOwner.ts`). (None exist yet.)

## Auth

Identity is a **GhlAccount with `accountType = internal`** (created by `scripts/admin/provision-owner.ts`): contactId = your HQ
contact, locationId = the HQ location, linked to an active `User` (no role, no `User.ghl*` fields).

### Primary: SMS via the CRM link (`/enter?locationId=<id>`)

GHL custom menu link in the **HQ sub-account**: `https://admin.reiblast.app/enter?locationId={{location.id}}`
(`{{location.id}}` is GHL's location merge field). The page:

1. `locationId` must be in `ADMIN_LOCATION_IDS`;
2. a `GhlAccount` with that locationId must exist and be `internal`;
3. its `User` must be `active`.

Any failure shows the same generic "Access not available" screen (reason in `AdminAuditLog` only). On success it creates an
`AdminAuthChallenge` and texts a 6-digit code (`crypto.randomInt`) to the account's GHL contact through the HQ Conversations
API (`lib/admin/sms.ts`; `lib/otp.ts` and `User.otp*` are not used). Stored as an HMAC (keyed by `ADMIN_SESSION_SECRET`,
bound to the challenge id); 10-minute expiry; max 5 attempts per challenge (claimed atomically before comparing);
max 3 sends per 15 minutes; timing-safe compare; a new send supersedes the old code. A page load within 60 s of a send does
not send again. This path depends on GHL (the menu link and SMS delivery); the fallback below does not.

### Fallback: `/admin/login` (TOTP or backup code)

For when GHL is unavailable. Enter the 6-digit authenticator code (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step; secret in
`ADMIN_TOTP_SECRET`; a step can't be reused) or a one-time backup code (16 chars, 10 issued, stored as SHA-256, consumed
atomically). It signs in the same internal account (exactly one active internal account must be allowlisted).

Every failure returns the same generic message. After 10 `login_failed` audit rows in 15 minutes all sign-in attempts are
refused until the window clears.

### Session

`lib/admin/session.ts`: `jose` HS256, its own `ADMIN_SESSION_SECRET` (≥ 32 chars; **fails closed** if missing, short, or equal
to `TOOLS_SESSION_SECRET`), subject = `GhlAccount.id`. Cookie `reiblast_admin`: host-only (no `domain`), HttpOnly, Secure,
SameSite=Strict, 8 hours. `requireOwner()` re-checks on **every** page, server action and API handler that the host is an
admin host, the token verifies, the account still exists and is `internal`, its locationId is still allowlisted and matches
the token, and its `User` is `active`. Sign out clears the cookie and logs it.

## Setup

1. Migrations (pipeline branch first): `20260927000000_ghl_account_type`, `20260927010000_admin_auth_tables`.
2. Provision the owner (dry-run first, refuses the production host):
   `PRISMA_TARGET=dev npx tsx scripts/admin/provision-owner.ts --email=<agency email> --contact-id=<HQ contact id>` then `--apply`.
   It verifies via read-only GHL GET that the contact is in the HQ location and has a phone.
3. Fallback auth: `PRISMA_TARGET=dev npx tsx scripts/admin/setup-owner-auth.ts` (dry-run) then `--apply`. Save the printed
   `ADMIN_TOTP_SECRET` and backup codes (shown once); add the secret to an authenticator app by manual entry.
4. Set env vars in Vercel (and `.env.local`): `ADMIN_SESSION_SECRET`, `ADMIN_TOTP_SECRET`, `ADMIN_LOCATION_IDS` (= HQ location
   id), `NEON_STORAGE_LIMIT_MB`; on Preview also `ADMIN_PATH_ACCESS=true`.
5. Add `admin.reiblast.app` to the Vercel project's domains; create the GHL custom menu link above in the HQ sub-account.

The setup scripts write only to the database in `DATABASE_URL`; run them against the pipeline branch with
`DATABASE_URL`/`SEED_DATABASE_URL` pointing at it. Production needs the same steps, deliberately, later.

## Audit log (`AdminAuditLog`, append-only)

`action`: `login_sms`, `login_totp`, `login_backup`, `login_failed` (detail: stage + reason), `sms_sent`, `export`, `logout`,
with `ip` (first `x-forwarded-for`) and `createdAt`. Used for the login throttle and TOTP replay protection.

## Views

Overview and Health (Task 5); Revenue, Costs, Margin, Members are placeholders (Task 6). All reads go through
`getBillingDb()` and `lib/billing/reports/*`. Member counts exclude `internal` accounts. Every page shows the footer:
"Gross collected via GHL — processor fees, chargebacks and payouts not included. Reporting timezone: America/Denver."
