import type { PrismaClient } from "@prisma/client";

/**
 * Additive dual-write for NEW members: keeps a GhlAccount row alongside the live app's User row. Called from two live routes.
 * Contract with those routes: this NEVER throws and NEVER takes long — every failure is logged and swallowed, and the whole call
 * is bounded by a timeout, so the live route's behavior, response and status code cannot change because of it.
 */
const TIMEOUT_MS = 3000;

async function bounded(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await Promise.race([work(), new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS))]);
  } catch (err) {
    console.error(`[ghl-account dual-write] ${label} failed (ignored):`, err instanceof Error ? err.message : err);
  }
}

type Db = Pick<PrismaClient, "ghlAccount">;

/** After the payment webhook has stored User.ghlContactId: upsert the member GhlAccount by userId and refresh contactId. Internal accounts are never touched. */
export async function ensureGhlAccount(db: Db, p: { userId: string; contactId: string | null | undefined }): Promise<void> {
  if (!p.contactId) return;
  await bounded("ensureGhlAccount", async () => {
    const existing = await db.ghlAccount.findUnique({ where: { userId: p.userId }, select: { id: true, accountType: true, contactId: true } });
    if (!existing) {
      await db.ghlAccount.create({ data: { userId: p.userId, contactId: p.contactId as string, accountType: "member" } });
    } else if (existing.accountType === "member" && existing.contactId !== p.contactId) {
      await db.ghlAccount.update({ where: { id: existing.id }, data: { contactId: p.contactId as string } });
    }
  });
}

/** After the provisioning route has stored User.ghlLocationId: set GhlAccount.locationId (creating the member account first if a payment-webhook dual-write never ran). */
export async function setGhlAccountLocation(db: Db, p: { userId: string; locationId: string | null | undefined; contactId?: string | null }): Promise<void> {
  if (!p.locationId) return;
  await bounded("setGhlAccountLocation", async () => {
    const existing = await db.ghlAccount.findUnique({ where: { userId: p.userId }, select: { id: true, accountType: true, locationId: true } });
    if (!existing) {
      if (!p.contactId || p.contactId.startsWith("test_")) return; // nothing safe to create from
      await db.ghlAccount.create({ data: { userId: p.userId, contactId: p.contactId, locationId: p.locationId as string, accountType: "member" } });
    } else if (existing.accountType === "member" && existing.locationId !== p.locationId) {
      await db.ghlAccount.update({ where: { id: existing.id }, data: { locationId: p.locationId as string } });
    }
  });
}
