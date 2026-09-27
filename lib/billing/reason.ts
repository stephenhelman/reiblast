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
  | "server_misconfigured";

/** Auth outcome, checked in this order: an unset env var is a server problem, not a caller one. */
export function checkSecret(incoming: string | null, envName: string): "ok" | "missing" | "failed" | "misconfigured" {
  if (!process.env[envName]) return "misconfigured";
  if (!incoming) return "missing";
  return secretMatches(incoming, envName) ? "ok" : "failed";
}

/** Header names only — never values (a secret header's value must never reach a log or a GhlEvent row). */
export function headerNames(req: NextRequest): string[] {
  return [...req.headers.keys()].sort();
}

/** Top-level keys of a parsed JSON body, for logging shape without logging content (which may carry contact/invoice ids, fine, but keep it minimal and no secrets regardless). */
export function bodyKeys(body: unknown): string[] {
  return body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body as Record<string, unknown>).sort() : [];
}
