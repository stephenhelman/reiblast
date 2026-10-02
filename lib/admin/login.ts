import type { PrismaClient } from "@prisma/client";
import { consumeBackupCode, looksLikeBackupCode } from "./backupCodes";
import { discardChallenge, hasRecentLiveChallenge, issueChallenge, verifyChallenge } from "./challenge";
import { OTP_RESEND_COOLDOWN_MS } from "./config";
import { lastTotpStep, logAdmin, loginThrottled } from "./audit";
import { resolveEntry, resolveFallbackAccount, type EntryAccount } from "./entry";
import type { AdminSessionPayload } from "./session";
import { sendAdminSms } from "./sms";
import { verifyTotp } from "./totp";

type Db = Pick<PrismaClient, "ghlAccount" | "adminAuthChallenge" | "adminBackupCode" | "adminAuditLog">;
type Env = Record<string, string | undefined>;
type Ctx = { ip: string | null; now?: Date; env?: Env };

const session = (a: EntryAccount, method: AdminSessionPayload["method"]): AdminSessionPayload => ({ sub: a.accountId, locationId: a.locationId, method });

export type StartEntryStatus = "sent" | "cooldown" | "denied" | "rate_limited" | "send_failed";

/** Entry page load / resend: gate → (cooldown) → issue challenge → SMS to the account's GHL contact. */
export async function startEntry(db: Db, locationId: string | null, ctx: Ctx & { send?: typeof sendAdminSms; force?: boolean }): Promise<{ status: StartEntryStatus; account?: EntryAccount }> {
  const now = ctx.now ?? new Date();
  const entry = await resolveEntry(db, locationId, ctx.env);
  if (!entry.ok) {
    await logAdmin(db, "login_failed", { stage: "enter", reason: entry.reason }, ctx.ip);
    return { status: "denied" };
  }
  if (await loginThrottled(db, now)) {
    await logAdmin(db, "login_failed", { stage: "enter", reason: "throttled" }, ctx.ip);
    return { status: "denied" };
  }
  if (!ctx.force && (await hasRecentLiveChallenge(db, OTP_RESEND_COOLDOWN_MS, now))) return { status: "cooldown", account: entry.account };

  const issued = await issueChallenge(db, now, ctx.env);
  if (!issued.ok) return { status: "rate_limited", account: entry.account };

  const sent = await (ctx.send ?? sendAdminSms)(entry.account.contactId, issued.code);
  if (!sent.success) {
    await discardChallenge(db, issued.id);
    await logAdmin(db, "login_failed", { stage: "enter", reason: "sms_failed" }, ctx.ip);
    return { status: "send_failed", account: entry.account };
  }
  await logAdmin(db, "sms_sent", { challengeId: issued.id }, ctx.ip);
  return { status: "sent", account: entry.account };
}

export type LoginResult = { ok: true; session: AdminSessionPayload } | { ok: false };

/** Verify the SMS code from /admin/enter. Every failure is the same {ok:false}; the reason goes only to the audit log. */
export async function attemptSmsLogin(db: Db, locationId: string | null, code: string, ctx: Ctx): Promise<LoginResult> {
  const now = ctx.now ?? new Date();
  const fail = async (reason: string): Promise<LoginResult> => {
    await logAdmin(db, "login_failed", { stage: "sms", reason }, ctx.ip);
    return { ok: false };
  };
  const entry = await resolveEntry(db, locationId, ctx.env);
  if (!entry.ok) return fail(entry.reason);
  if (await loginThrottled(db, now)) return fail("throttled");
  const v = await verifyChallenge(db, code.trim(), now, ctx.env);
  if (!v.ok) return fail(v.reason);
  await logAdmin(db, "login_sms", null, ctx.ip);
  return { ok: true, session: session(entry.account, "sms") };
}

/** /admin/login fallback (GHL down): 6-digit TOTP or a backup code, for the same internal account. */
export async function attemptFallbackLogin(db: Db, input: string, ctx: Ctx): Promise<LoginResult> {
  const now = ctx.now ?? new Date();
  const env = ctx.env ?? process.env;
  const fail = async (reason: string): Promise<LoginResult> => {
    await logAdmin(db, "login_failed", { stage: "fallback", reason }, ctx.ip);
    return { ok: false };
  };
  const account = await resolveFallbackAccount(db, env);
  if (!account) return fail("no_account");
  if (await loginThrottled(db, now)) return fail("throttled");

  const code = input.trim();
  if (/^\d{6}$/.test(code)) {
    const secret = env.ADMIN_TOTP_SECRET;
    if (!secret) return fail("totp_not_configured");
    const r = verifyTotp(secret, code, now.getTime(), { afterStep: await lastTotpStep(db) });
    if (!r.ok) return fail("totp_wrong");
    await logAdmin(db, "login_totp", { step: r.step }, ctx.ip);
    return { ok: true, session: session(account, "totp") };
  }
  if (looksLikeBackupCode(code)) {
    if (!(await consumeBackupCode(db, code, now))) return fail("backup_wrong");
    await logAdmin(db, "login_backup", null, ctx.ip);
    return { ok: true, session: session(account, "backup") };
  }
  return fail("bad_format");
}
