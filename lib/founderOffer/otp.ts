import { TOOLS_OTP_SEND_COOLDOWN_MS } from "@/lib/constants";
import type { MintOtpParams, MintOtpResult, VerifyOtpParams, VerifyOtpResult } from "@/lib/otp";
import { claimWindow } from "./window";

export const OTP_WINDOW_MS = 60 * 60 * 1000;
export const MAX_STARTS_PER_ACCOUNT = 3;
export const MAX_CONFIRMS_PER_ACCOUNT = 10;
/** How long a code minted by the founders start can be confirmed (mirrors OTP_EXPIRY_MS in lib/otp.ts). */
export const OTP_BINDING_WINDOW_MS = 10 * 60 * 1000;

export type FounderIdentity = { ghlAccountId: string; discordUserId: string };

export type FounderOtpDb = {
  ghlAccount: { findUnique(args: any): Promise<{ contactId: string; user: { id: string; otpLastSentAt: Date | null } } | null> };
  discordLink: { findFirst(args: any): Promise<{ id: string } | null> };
  founderVerifyAttempt: { create(args: any): Promise<unknown>; count(args: any): Promise<number>; findFirst(args: any): Promise<{ createdAt: Date } | null> };
};

type Common = { db: FounderOtpDb; now?: () => Date; env?: Record<string, string | undefined> };
const clock = (d: Common) => (d.now ?? (() => new Date()))();

const accountQuery = (ghlAccountId: string) => ({ where: { id: ghlAccountId }, select: { contactId: true, user: { select: { id: true, otpLastSentAt: true } } } });
/** The Discord link behind the signed claim link must still exist for this exact pair. */
const linkStillValid = (db: FounderOtpDb, i: FounderIdentity) => db.discordLink.findFirst({ where: { ghlAccountId: i.ghlAccountId, discordUserId: i.discordUserId }, select: { id: true } });

export type OtpStartResponse =
  | { result: "sent"; phoneLast4: string }
  | { result: "refused"; reason: "not_open" | "link_invalid" | "rate_limited" | "delivery_failed" };

/**
 * Start: identity comes from the verified link, so there is nothing to mask. Window, then attempt row (before any early return after
 * that), then per-account limit, then cooldown, then phone lookup, mint, and finally the "sent" binding (written AFTER the mint so it
 * is never older than User.otpLastSentAt).
 */
export async function handleOtpStart(
  deps: Common & { mintOtp: (p: MintOtpParams) => Promise<MintOtpResult>; fetchPhoneLast4: (contactId: string) => Promise<string | null> },
  id: FounderIdentity,
): Promise<OtpStartResponse> {
  const { db } = deps;
  const now = clock(deps);
  if (claimWindow(now, deps.env) !== "open") return { result: "refused", reason: "not_open" };

  await db.founderVerifyAttempt.create({ data: { kind: "start", ghlAccountId: id.ghlAccountId, discordUserId: id.discordUserId, createdAt: now } });
  const starts = await db.founderVerifyAttempt.count({ where: { kind: "start", ghlAccountId: id.ghlAccountId, createdAt: { gte: new Date(now.getTime() - OTP_WINDOW_MS) } } });
  if (starts > MAX_STARTS_PER_ACCOUNT) return { result: "refused", reason: "rate_limited" };

  if (!(await linkStillValid(db, id))) return { result: "refused", reason: "link_invalid" };
  const account = await db.ghlAccount.findUnique(accountQuery(id.ghlAccountId));
  if (!account) return { result: "refused", reason: "link_invalid" };

  const last = account.user.otpLastSentAt;
  if (last && now.getTime() - last.getTime() < TOOLS_OTP_SEND_COOLDOWN_MS) return { result: "refused", reason: "rate_limited" };

  const phoneLast4 = await deps.fetchPhoneLast4(account.contactId);
  if (!phoneLast4) return { result: "refused", reason: "delivery_failed" };
  const sent = await deps.mintOtp({ userId: account.user.id, contactId: account.contactId, phone: "", flow: "founders" });
  if (!sent.success) return { result: "refused", reason: "delivery_failed" };

  await db.founderVerifyAttempt.create({ data: { kind: "sent", ghlAccountId: id.ghlAccountId, discordUserId: id.discordUserId, createdAt: clock(deps) } });
  return { result: "sent", phoneLast4 };
}

export type OtpConfirmResponse =
  | { result: "verified"; userId: string; ghlAccountId: string }
  | { result: "refused"; reason: "not_open" | "link_invalid" | "rate_limited" | "code_expired" | "code_locked" }
  | { result: "refused"; reason: "invalid_code"; attemptsRemaining?: number };

/**
 * Confirm: requires THIS flow's "sent" binding and refuses when User.otpLastSentAt is newer than it (a code minted by another
 * flow), answering invalid_code WITHOUT calling verifyOtp so nothing is consumed and no attempt is counted. 3 wrong tries lock the code.
 */
export async function handleOtpConfirm(
  deps: Common & { verifyOtp: (p: VerifyOtpParams) => Promise<VerifyOtpResult> },
  id: FounderIdentity & { code: string },
): Promise<OtpConfirmResponse> {
  const { db } = deps;
  const now = clock(deps);
  if (claimWindow(now, deps.env) !== "open") return { result: "refused", reason: "not_open" };

  await db.founderVerifyAttempt.create({ data: { kind: "confirm", ghlAccountId: id.ghlAccountId, discordUserId: id.discordUserId, createdAt: now } });
  const confirms = await db.founderVerifyAttempt.count({ where: { kind: "confirm", ghlAccountId: id.ghlAccountId, createdAt: { gte: new Date(now.getTime() - OTP_WINDOW_MS) } } });
  if (confirms > MAX_CONFIRMS_PER_ACCOUNT) return { result: "refused", reason: "rate_limited" };

  if (!(await linkStillValid(db, id))) return { result: "refused", reason: "link_invalid" };
  const account = await db.ghlAccount.findUnique(accountQuery(id.ghlAccountId));
  if (!account) return { result: "refused", reason: "link_invalid" };

  const sentRow = await db.founderVerifyAttempt.findFirst({
    where: { kind: "sent", ghlAccountId: id.ghlAccountId, discordUserId: id.discordUserId, createdAt: { gte: new Date(now.getTime() - OTP_BINDING_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
  });
  const last = account.user.otpLastSentAt;
  if (!sentRow || (last && last.getTime() > sentRow.createdAt.getTime())) return { result: "refused", reason: "invalid_code" };

  const otp = await deps.verifyOtp({ userId: account.user.id, code: id.code });
  if (otp.status === "expired") return { result: "refused", reason: "code_expired" };
  if (otp.status === "locked_out") return { result: "refused", reason: "code_locked" };
  if (otp.status === "wrong") return { result: "refused", reason: "invalid_code", attemptsRemaining: otp.attemptsRemaining };
  return { result: "verified", userId: account.user.id, ghlAccountId: id.ghlAccountId };
}
