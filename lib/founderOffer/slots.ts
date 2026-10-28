import type { PrismaClient } from "@prisma/client";

export const FOUNDER_SLOTS_TOTAL = 10;
/** An unpaid (PENDING_PAYMENT) claim holds its slot for 25 hours (24h to pay + 1h grace); after that the slot counts as free. */
export const PENDING_HOLD_HOURS = 25;
const HOLD_MS = PENDING_HOLD_HOURS * 60 * 60 * 1000;

export type SlotClaim = { status: string; claimedAt: Date };

/**
 * THE one place the 25-hour rule lives. FREE_WINNER and PAID hold a slot for good; PENDING_PAYMENT holds one only while
 * claimedAt is within the last 25 hours; RELEASED never does.
 */
export function isSlotHeld(c: SlotClaim, now: Date): boolean {
  if (c.status === "FREE_WINNER" || c.status === "PAID") return true;
  return c.status === "PENDING_PAYMENT" && c.claimedAt.getTime() > now.getTime() - HOLD_MS;
}

type NowDb = { $queryRaw: PrismaClient["$queryRaw"] };
type ClaimsDb = { founderClaim: { findMany(args: any): Promise<SlotClaim[]> } };

/** The database's clock (not the app server's), so every instance agrees on the 25-hour boundary. */
export async function dbNow(db: NowDb): Promise<Date> {
  const rows = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  return new Date(rows[0].now);
}

/** Slots held right now. Works on the client or a transaction client. */
export async function countSlotsTaken(db: NowDb & ClaimsDb, now?: Date): Promise<number> {
  const at = now ?? (await dbNow(db));
  const rows = await db.founderClaim.findMany({ where: { status: { in: ["FREE_WINNER", "PAID", "PENDING_PAYMENT"] } }, select: { status: true, claimedAt: true } });
  return rows.filter((r) => isSlotHeld(r, at)).length;
}

export const slotsLeftFrom = (taken: number): number => Math.max(0, FOUNDER_SLOTS_TOTAL - taken);
