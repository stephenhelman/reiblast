import type { Prisma, PrismaClient } from "@prisma/client";
import { LOGIN_FAIL_MAX, LOGIN_FAIL_WINDOW_MS } from "./config";

type Db = Pick<PrismaClient, "adminAuditLog">;

export type AdminAction = "login_sms" | "login_totp" | "login_backup" | "login_failed" | "sms_sent" | "export" | "logout";

/** Append-only. Never throws: an audit-write failure must not turn into a different auth outcome. */
export async function logAdmin(db: Db, action: AdminAction, detail: Record<string, unknown> | null = null, ip: string | null = null): Promise<void> {
  try {
    await db.adminAuditLog.create({ data: { action, detail: (detail ?? undefined) as Prisma.InputJsonObject | undefined, ip } });
  } catch (err) {
    console.error("[admin-audit] write failed:", err instanceof Error ? err.message : err);
  }
}

/** True once LOGIN_FAIL_MAX login_failed rows exist inside the window; blocks further attempts (covers TOTP/backup). */
export async function loginThrottled(db: Db, now = new Date()): Promise<boolean> {
  const n = await db.adminAuditLog.count({ where: { action: "login_failed", createdAt: { gte: new Date(now.getTime() - LOGIN_FAIL_WINDOW_MS) } } });
  return n >= LOGIN_FAIL_MAX;
}

/** Last accepted TOTP step (recorded in the login_totp audit detail) for replay protection. */
export async function lastTotpStep(db: Db): Promise<number | undefined> {
  const row = await db.adminAuditLog.findFirst({ where: { action: "login_totp" }, orderBy: { createdAt: "desc" } });
  const step = (row?.detail as { step?: unknown } | null)?.step;
  return typeof step === "number" ? step : undefined;
}

export const clientIp = (h: { get(name: string): string | null }): string | null => h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
