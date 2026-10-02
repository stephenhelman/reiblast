import type { PrismaClient } from "@prisma/client";
import { adminLocationIds } from "./config";

type Env = Record<string, string | undefined>;
type Db = Pick<PrismaClient, "ghlAccount">;

export type EntryFailure = "missing_location" | "not_allowlisted" | "no_account" | "not_internal" | "no_user" | "user_inactive" | "no_contact";
export type EntryAccount = { accountId: string; contactId: string; locationId: string; userId: string };
export type EntryResult = { ok: true; account: EntryAccount } | { ok: false; reason: EntryFailure };

/**
 * The entry-flow gate (mirrors tools/enter): locationId ∈ ADMIN_LOCATION_IDS → GhlAccount with that locationId that is
 * `internal` → its User is `active`. The caller shows ONE generic page for every failure; `reason` is for the audit log only.
 */
export async function resolveEntry(db: Db, locationId: string | null | undefined, env: Env = process.env): Promise<EntryResult> {
  if (!locationId) return { ok: false, reason: "missing_location" };
  if (!adminLocationIds(env).includes(locationId)) return { ok: false, reason: "not_allowlisted" };

  const account = await db.ghlAccount.findUnique({ where: { locationId }, select: { id: true, contactId: true, locationId: true, accountType: true, user: { select: { id: true, status: true } } } });
  if (!account) return { ok: false, reason: "no_account" };
  if (account.accountType !== "internal") return { ok: false, reason: "not_internal" };
  if (!account.user) return { ok: false, reason: "no_user" };
  if (account.user.status !== "active") return { ok: false, reason: "user_inactive" };
  if (!account.contactId || !account.locationId) return { ok: false, reason: "no_contact" };
  return { ok: true, account: { accountId: account.id, contactId: account.contactId, locationId: account.locationId, userId: account.user.id } };
}

/**
 * /admin/login (TOTP / backup code) has no locationId: it targets THE internal account whose locationId is allowlisted.
 * Anything other than exactly one active match → null (misconfiguration must not pick an account arbitrarily).
 */
export async function resolveFallbackAccount(db: Db, env: Env = process.env): Promise<EntryAccount | null> {
  const ids = adminLocationIds(env);
  if (ids.length === 0) return null;
  const rows = await db.ghlAccount.findMany({
    where: { accountType: "internal", locationId: { in: ids } },
    select: { id: true, contactId: true, locationId: true, user: { select: { id: true, status: true } } },
  });
  const active = rows.filter((r) => r.user?.status === "active" && r.locationId);
  if (active.length !== 1) return null;
  const a = active[0];
  return { accountId: a.id, contactId: a.contactId, locationId: a.locationId as string, userId: (a.user as { id: string }).id };
}
