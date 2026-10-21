import type { NextRequest } from "next/server";
import { secretMatches } from "./secret";

/**
 * Shared reason-code vocabulary for GHL → server trigger/webhook responses (jobs route + stage-changed / invoice-event /
 * payment-event). The HTTP status is always 200 (contract rule 6); `reason` says what actually happened, for GHL's own
 * workflow logs and for Health. Never put a secret value, a stack trace, or an "expected" value in here or in the response.
 */
export type Reason =
  | "accepted"
  | "auth_missing"
  | "auth_failed"
  | "bad_json"
  | "unknown_job"
  | "in_flight"
  | "continuation_cap"
  | "code_sent" // Discord verify-start: a code was texted to the member's phone on file
  | "linked" // Discord verify: this Discord account is (now) linked to the member
  | "already_linked" // the member, or this Discord account, is already linked to a different counterpart
  | "not_eligible" // covers "no such account" too — the bot must not be able to tell the two apart
  | "revoked" // Discord bot revoke: role removed
  | "not_in_guild" // Discord bot revoke: member is not in the guild, nothing to do
  | "not_holding_role" // Discord bot revoke: member is in the guild but did not hold the role
  | "discord_unavailable" // Discord bot revoke: gateway not ready or a Discord API failure — retry
  | "rate_limited"
  | "invalid_code" // Discord verify-confirm: wrong code (attemptsRemaining accompanies it)
  | "code_expired" // no live code (expired, never sent, or already used)
  | "code_locked" // too many wrong attempts on the current code
  | "bad_request" // body is valid JSON but fails validation (bad Discord id, missing/both identifiers, malformed value)
  | "delivery_failed" // eligible, but the phone lookup or the SMS send failed
  | "server_misconfigured" // a required env var is unset — deterministic, known cause
  | "internal_error"; // anything else unexpected (a thrown exception) — cause is not known/deterministic

/** Auth outcome, checked in this order: an unset env var is a server problem, not a caller one. */
export function checkSecret(incoming: string | null, envName: string): "ok" | "missing" | "failed" | "misconfigured" {
  if (!process.env[envName]) return "misconfigured";
  if (!incoming) return "missing";
  return secretMatches(incoming, envName) ? "ok" : "failed";
}

/** Which of these env vars are unset — for a "server_misconfigured" log line. Never logs a value, only names. */
export function missingEnvVars(names: string[]): string[] {
  return names.filter((n) => !process.env[n]);
}

/** Log an unexpected exception server-side only: message and stack, never in the response. */
export function logInternalError(label: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${label}] internal error:`, e.message, e.stack ? `\n${e.stack}` : "");
}

/** Header names only — never values (a secret header's value must never reach a log or a GhlEvent row). */
export function headerNames(req: NextRequest): string[] {
  return [...req.headers.keys()].sort();
}

/** Top-level keys of a parsed JSON body, for logging shape without logging content (which may carry contact/invoice ids, fine, but keep it minimal and no secrets regardless). */
export function bodyKeys(body: unknown): string[] {
  return body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body as Record<string, unknown>).sort() : [];
}
