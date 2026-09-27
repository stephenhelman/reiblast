import { walletBalance } from "../ghlWallet";
import { add, sub, sumOf, type Money } from "../reports/money";
import { Prisma } from "@prisma/client";
import type { BalanceReading } from "./types";

/** Live read via the existing agency-key wallet client (GET only). Unavailable/error → "unknown", never a thrown failure. */
export async function readBalance(locationId: string | null | undefined): Promise<BalanceReading> {
  if (!locationId) return { status: "unknown", why: "no location yet" };
  try {
    const r = await walletBalance(locationId);
    if (r.status === "ok" && r.balance !== null) return { status: "ok", value: new Prisma.Decimal(String(r.balance)).toFixed(6), estimated: false };
    return { status: "unknown", why: r.status === "unavailable" ? "wallet unavailable" : "wallet read error" };
  } catch {
    return { status: "unknown", why: "wallet read error" };
  }
}

// ── replay: estimated balances ──────────────────────────────────────────────

/** An "ok" balance snapshot: when it was taken and what it read. */
export type BalanceAnchor = { at: Date; balance: Money };

/** Snapshots this close before an event are used as-is (a real reading, not an estimate). */
export const SNAPSHOT_FRESH_MS = 36 * 3600 * 1000;

/**
 * Balance at time `t` reconstructed from a known anchor reading. `netChange` is the signed sum of everything that moved the
 * balance in the interval BETWEEN t and the anchor: recharge credits (+) and wallet usage (charges are negative).
 *   t before the anchor → balance(t) = anchor − netChange(t, anchor]
 *   t after  the anchor → balance(t) = anchor + netChange(anchor, t]
 * It is an ESTIMATE: credited amounts are taken from the ledger (fees, timing inside the interval and unrecorded credits are unknown).
 */
export function estimateBalanceAt(anchor: BalanceAnchor, t: Date, netChange: Money): Money {
  return t.getTime() <= anchor.at.getTime() ? sub(anchor.balance, netChange) : add(anchor.balance, netChange);
}

export type SnapshotLite = { at: Date; status: string; balance: Money | null };

/** Nearest usable ("ok") snapshot to `t`, before or after. */
export function nearestAnchor(snapshots: SnapshotLite[], t: Date): BalanceAnchor | null {
  let best: BalanceAnchor | null = null;
  for (const s of snapshots) {
    if (s.status !== "ok" || s.balance === null) continue;
    if (!best || Math.abs(s.at.getTime() - t.getTime()) < Math.abs(best.at.getTime() - t.getTime())) best = { at: s.at, balance: s.balance };
  }
  return best;
}

/** A real snapshot taken shortly BEFORE the event, if any (then no estimate is needed). */
export function freshSnapshotBefore(snapshots: SnapshotLite[], t: Date): Money | null {
  let best: SnapshotLite | null = null;
  for (const s of snapshots) {
    if (s.status !== "ok" || s.balance === null) continue;
    const age = t.getTime() - s.at.getTime();
    if (age >= 0 && age <= SNAPSHOT_FRESH_MS && (!best || s.at > best.at)) best = s;
  }
  return best ? (best.balance as Money) : null;
}

export type Credit = { at: Date; amount: Money };

/** Signed net change strictly after `from` up to and including `to`, from recharge credits + a precomputed usage sum. */
export function netChangeBetween(from: Date, to: Date, credits: Credit[], usageStoredSum: Money): Money {
  const lo = Math.min(from.getTime(), to.getTime());
  const hi = Math.max(from.getTime(), to.getTime());
  const c = credits.filter((x) => x.at.getTime() > lo && x.at.getTime() <= hi).map((x) => x.amount);
  return add(sumOf(c), usageStoredSum);
}

/** Reading for a replay event: a fresh real snapshot, else an estimate from the nearest anchor, else unknown. */
export function resolveReplayBalance(args: { snapshots: SnapshotLite[]; t: Date; credits: Credit[]; usageBetween: (anchorAt: Date, t: Date) => Money | null }): BalanceReading {
  const fresh = freshSnapshotBefore(args.snapshots, args.t);
  if (fresh !== null) return { status: "ok", value: fresh, estimated: false };
  const anchor = nearestAnchor(args.snapshots, args.t);
  if (!anchor) return { status: "unknown", why: "no balance snapshot to reconstruct from" };
  const usage = args.usageBetween(anchor.at, args.t);
  if (usage === null) return { status: "unknown", why: "usage history unavailable" };
  return { status: "ok", value: estimateBalanceAt(anchor, args.t, netChangeBetween(anchor.at, args.t, args.credits, usage)), estimated: true };
}

