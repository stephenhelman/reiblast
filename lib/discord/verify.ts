import { TOOLS_OTP_SEND_COOLDOWN_MS } from "@/lib/constants";
import type { MintOtpParams, MintOtpResult } from "@/lib/otp";
import type { Reason } from "@/lib/billing/reason";

/** Rate limits for verify-start, counted from DiscordVerifyAttempt rows in the window. */
export const START_WINDOW_MS = 60 * 60 * 1000;
export const MAX_STARTS_PER_DISCORD_ID = 5;
export const MAX_STARTS_PER_MEMBER = 3;

/** User.status values that mean "completed the onboarding form and not suspended/inactive". Anything else fails closed. */
export const ELIGIBLE_STATUSES: readonly string[] = ["onboarding_complete", "provisioning", "active"];

export type VerifyIdentifier = { email: string } | { locationId: string };
export type ParsedStart = { discordUserId: string; identifier: VerifyIdentifier };

/** Signup email is the lookup key: lowercase AND trim. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Validates a verify-start / verify-confirm body. Returns null for anything malformed (caller answers bad_request). */
export function parseIdentity(body: Record<string, unknown>): ParsedStart | null {
  const { discordUserId, email, locationId } = body;
  if (typeof discordUserId !== "string" || !/^\d{15,25}$/.test(discordUserId)) return null;
  const hasEmail = email !== undefined && email !== null && email !== "";
  const hasLoc = locationId !== undefined && locationId !== null && locationId !== "";
  if (hasEmail === hasLoc) return null; // exactly one identifier
  if (hasEmail) {
    if (typeof email !== "string") return null;
    const e = normalizeEmail(email);
    if (e.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(e)) return null;
    return { discordUserId, identifier: { email: e } };
  }
  if (typeof locationId !== "string") return null;
  const l = locationId.trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(l)) return null;
  return { discordUserId, identifier: { locationId: l } };
}

export type AccountWithUser = {
  id: string;
  contactId: string;
  accountType: string;
  locationId?: string | null;
  user: { id: string; status: string; otpLastSentAt: Date | null; ghlLocationId?: string | null };
};

/** Eligible = onboarding form done and not suspended/inactive, a plain member account, and not a test_ contact. */
export function isEligible(a: AccountWithUser | null): a is AccountWithUser {
  return !!a && a.accountType === "member" && !a.contactId.startsWith("test_") && ELIGIBLE_STATUSES.includes(a.user.status);
}

/** The slice of the Prisma client verify-start uses (kept narrow so tests can fake it). */
export type VerifyDb = {
  ghlAccount: { findMany(args: any): Promise<AccountWithUser[]> };
  discordLink: { findFirst(args: any): Promise<{ ghlAccountId: string; discordUserId: string } | null> };
  discordVerifyAttempt: { create(args: any): Promise<unknown>; count(args: any): Promise<number> };
};

export type VerifyStartDeps = {
  db: VerifyDb;
  mintOtp: (p: MintOtpParams) => Promise<MintOtpResult>;
  fetchPhoneLast4: (contactId: string) => Promise<string | null>;
  now?: () => Date;
};

export type VerifyStartResponse =
  | { result: "code_sent"; reason: "code_sent"; phoneLast4: string }
  | { result: "linked"; reason: "linked" }
  | { result: "refused"; reason: Extract<Reason, "already_linked" | "not_eligible" | "rate_limited" | "delivery_failed"> };

const refused = (reason: Extract<VerifyStartResponse, { result: "refused" }>["reason"]): VerifyStartResponse => ({ result: "refused", reason });

export function accountLookup(identifier: VerifyIdentifier) {
  const where = "email" in identifier ? { user: { email: identifier.email } } : { OR: [{ locationId: identifier.locationId }, { user: { ghlLocationId: identifier.locationId } }] };
  return { where, take: 2, select: { id: true, contactId: true, accountType: true, locationId: true, user: { select: { id: true, status: true, otpLastSentAt: true, ghlLocationId: true } } } };
}

/**
 * Resolves the identifier to a GhlAccount (with its User), or null. A location id is matched against BOTH GhlAccount.locationId and
 * User.ghlLocationId; if the two disagree for the account, or the id matches two different accounts, the answer is null — the caller
 * treats that exactly like "not found" (so it is not_eligible) and only a fixed marker is logged, never an id.
 */
export async function resolveAccount(db: VerifyDb, identifier: VerifyIdentifier): Promise<AccountWithUser | null> {
  const found = await db.ghlAccount.findMany(accountLookup(identifier));
  if (found.length === 0) return null;
  const a = found[0];
  if (found.length > 1 || (a.locationId && a.user.ghlLocationId && a.locationId !== a.user.ghlLocationId)) {
    console.warn("[discord/verify] location_id_mismatch");
    return null;
  }
  return a;
}

/**
 * verify-start. Order matters for not_found == not_eligible: resolve, record the attempt (always, before any early return),
 * apply the per-Discord-ID limit, THEN eligibility — so the two refusals do identical work and return identical bodies. The
 * per-member limit runs only after eligibility, because it would otherwise reveal that an ineligible account exists.
 */
export async function handleVerifyStart(deps: VerifyStartDeps, { discordUserId, identifier }: ParsedStart): Promise<VerifyStartResponse> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - START_WINDOW_MS);

  const account = await resolveAccount(db, identifier);

  await db.discordVerifyAttempt.create({ data: { kind: "start", discordUserId, ghlAccountId: account?.id ?? null, createdAt: now } });

  const byDiscord = await db.discordVerifyAttempt.count({ where: { kind: "start", discordUserId, createdAt: { gte: since } } });
  if (byDiscord > MAX_STARTS_PER_DISCORD_ID) return refused("rate_limited");

  if (!isEligible(account)) return refused("not_eligible");

  const byMember = await db.discordVerifyAttempt.count({ where: { kind: "start", ghlAccountId: account.id, createdAt: { gte: since } } });
  if (byMember > MAX_STARTS_PER_MEMBER) return refused("rate_limited");

  const link = await db.discordLink.findFirst({ where: { OR: [{ ghlAccountId: account.id }, { discordUserId }] } });
  if (link) {
    return link.ghlAccountId === account.id && link.discordUserId === discordUserId ? { result: "linked", reason: "linked" } : refused("already_linked");
  }

  const last = account.user.otpLastSentAt;
  if (last && now.getTime() - last.getTime() < TOOLS_OTP_SEND_COOLDOWN_MS) return refused("rate_limited");

  // Only now — eligible, under the limits, not linked — touch GHL: look up the phone, then send.
  const phoneLast4 = await deps.fetchPhoneLast4(account.contactId);
  if (!phoneLast4) return refused("delivery_failed");

  const sent = await deps.mintOtp({ userId: account.user.id, contactId: account.contactId, phone: "", flow: "discord" });
  if (!sent.success) return refused("delivery_failed");

  return { result: "code_sent", reason: "code_sent", phoneLast4 };
}
