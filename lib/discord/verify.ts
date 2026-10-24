import { TOOLS_OTP_SEND_COOLDOWN_MS } from "@/lib/constants";
import type { MintOtpParams, MintOtpResult, VerifyOtpParams, VerifyOtpResult } from "@/lib/otp";
import type { Reason } from "@/lib/billing/reason";

/** Rate limits for verify-start, counted from DiscordVerifyAttempt rows in the window. */
export const START_WINDOW_MS = 60 * 60 * 1000;
export const MAX_STARTS_PER_DISCORD_ID = 5;
export const MAX_STARTS_PER_MEMBER = 3;
/** How long a code minted by verify-start can be confirmed — mirrors OTP_EXPIRY_MS in lib/otp.ts (10 minutes). */
export const OTP_BINDING_WINDOW_MS = 10 * 60 * 1000;

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
  discordVerifyAttempt: { create(args: any): Promise<unknown>; count(args: any): Promise<number>; findFirst(args: any): Promise<{ createdAt: Date } | null> };
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

  // Marks "THIS Discord id + member just had a code sent by the Discord flow". verify-confirm requires it, so a code minted by the
  // tools or onboarding flow can't be redeemed here. Written after the mint on purpose: it must not be older than User.otpLastSentAt.
  await db.discordVerifyAttempt.create({ data: { kind: "sent", discordUserId, ghlAccountId: account.id, createdAt: (deps.now ?? (() => new Date()))() } });

  return { result: "code_sent", reason: "code_sent", phoneLast4 };
}

// ---------------------------------------------------------------------------------------------------------------------
// verify-confirm
// ---------------------------------------------------------------------------------------------------------------------

export const MAX_CONFIRMS_PER_DISCORD_ID = 10;

export type ParsedConfirm = ParsedStart & { code: string };

/** verify-start's body plus a 6-digit `code`. Anything else (including a code that can't possibly be right) is a bad_request. */
export function parseConfirm(body: Record<string, unknown>): ParsedConfirm | null {
  const id = parseIdentity(body);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  return id && /^\d{6}$/.test(code) ? { ...id, code } : null;
}

type LinkRow = { ghlAccountId: string; discordUserId: string };
export type ConfirmDb = VerifyDb & {
  discordLink: VerifyDb["discordLink"] & { create(args: any): Promise<LinkRow> };
  $transaction<T>(fn: (tx: Pick<ConfirmDb, "discordLink">) => Promise<T>): Promise<T>;
};

export type VerifyConfirmDeps = {
  db: ConfirmDb;
  verifyOtp: (p: VerifyOtpParams) => Promise<VerifyOtpResult>;
  now?: () => Date;
};

export type VerifyConfirmResponse =
  | { result: "linked"; reason: "linked" }
  | { result: "refused"; reason: "invalid_code"; attemptsRemaining?: number } // attemptsRemaining present only for a wrong code; absent when no matching start exists
  | { result: "refused"; reason: Extract<Reason, "already_linked" | "not_eligible" | "rate_limited" | "code_expired" | "code_locked"> };

const refusedC = (reason: Extract<VerifyConfirmResponse, { result: "refused" }>["reason"]): VerifyConfirmResponse => ({ result: "refused", reason } as VerifyConfirmResponse);
const LINKED: VerifyConfirmResponse = { result: "linked", reason: "linked" };

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
const isFkViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2003";

/**
 * verify-confirm. Same shape as handleVerifyStart: resolve, record the attempt (kind "confirm") before any early return, Discord-id
 * limit, THEN eligibility (re-run now — status may have changed since start), then the existing-link check (which makes a repeat
 * confirm for the same pair idempotent without needing a live code), then the code, then the link create.
 */
export async function handleVerifyConfirm(deps: VerifyConfirmDeps, { discordUserId, identifier, code }: ParsedConfirm): Promise<VerifyConfirmResponse> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - START_WINDOW_MS);

  const account = await resolveAccount(db, identifier);

  await db.discordVerifyAttempt.create({ data: { kind: "confirm", discordUserId, ghlAccountId: account?.id ?? null, createdAt: now } });

  const byDiscord = await db.discordVerifyAttempt.count({ where: { kind: "confirm", discordUserId, createdAt: { gte: since } } });
  if (byDiscord > MAX_CONFIRMS_PER_DISCORD_ID) return refusedC("rate_limited");

  if (!isEligible(account)) return refusedC("not_eligible");

  const existing = await db.discordLink.findFirst({ where: { OR: [{ ghlAccountId: account.id }, { discordUserId }] } });
  if (existing) return existing.ghlAccountId === account.id && existing.discordUserId === discordUserId ? LINKED : refusedC("already_linked");

  // Bind to our own start: the code in the User's single OTP slot must be the one verify-start minted for THIS Discord id + member.
  // Otherwise (no recent send, a send for someone else, or a tools/onboarding mint since) answer invalid_code WITHOUT calling
  // verifyOtp, so nothing is consumed and no attempt is counted against the member's real code.
  const sentRow = await db.discordVerifyAttempt.findFirst({
    where: { kind: "sent", discordUserId, ghlAccountId: account.id, createdAt: { gte: new Date(now.getTime() - OTP_BINDING_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
  });
  const last = account.user.otpLastSentAt;
  if (!sentRow || (last && last.getTime() > sentRow.createdAt.getTime())) return { result: "refused", reason: "invalid_code" };

  const otp = await deps.verifyOtp({ userId: account.user.id, code });
  if (otp.status === "expired") return refusedC("code_expired");
  if (otp.status === "locked_out") return refusedC("code_locked");
  if (otp.status === "wrong") return { result: "refused", reason: "invalid_code", attemptsRemaining: otp.attemptsRemaining };

  // Code accepted (and consumed). Create the link atomically; both unique constraints are the final arbiter in a race.
  try {
    return await db.$transaction(async (tx) => {
      const clash = await tx.discordLink.findFirst({ where: { OR: [{ ghlAccountId: account.id }, { discordUserId }] } });
      if (clash) return clash.ghlAccountId === account.id && clash.discordUserId === discordUserId ? LINKED : refusedC("already_linked");
      await tx.discordLink.create({ data: { ghlAccountId: account.id, discordUserId } });
      return LINKED;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Lost a race between the check and the insert. Re-read to tell "same pair, someone beat us to it" from a real conflict.
      const winner = await db.discordLink.findFirst({ where: { OR: [{ ghlAccountId: account.id }, { discordUserId }] } });
      return winner && winner.ghlAccountId === account.id && winner.discordUserId === discordUserId ? LINKED : refusedC("already_linked");
    }
    if (isFkViolation(e)) return refusedC("not_eligible"); // the account was deleted between the check and the insert
    throw e;
  }
}
