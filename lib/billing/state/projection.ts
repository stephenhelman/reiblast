import type { PrismaClient } from "@prisma/client";
import type { Snapshot } from "./types";

/**
 * SHADOW PROJECTION. Shadow and replay runs never write GhlAccount. The projected state of an account is the `to*` values of its
 * latest DunningDecision **of the same mode** — for shadow, the latest SHADOW decision — ordered by eventAt (then createdAt), not by
 * insertion time. REPLAY rows never feed the shadow projection: they are analysis of history, kept separate. With no shadow decision
 * yet, the projection is seeded from the account row (billingState / warningCount / pauseReason); `coreFailureOpen` is inferred there
 * as "payment_failed with no strikes".
 */
export type Projection = Snapshot & { source: "decision" | "account"; lastEventAt: Date | null };

type Db = Pick<PrismaClient, "dunningDecision" | "ghlAccount">;

export const seedFromAccount = (a: { billingState: Snapshot["state"]; warningCount: number; pauseReason: Snapshot["pauseReason"] }): Projection => ({
  state: a.billingState,
  strikes: a.warningCount,
  pauseReason: a.pauseReason,
  coreFailureOpen: a.billingState === "payment_failed" && a.warningCount === 0,
  source: "account",
  lastEventAt: null,
});

export async function loadProjection(db: Db, ghlAccountId: string, mode: "shadow" | "replay" = "shadow"): Promise<Projection | null> {
  const latest = await db.dunningDecision.findFirst({
    where: { ghlAccountId, mode },
    orderBy: [{ eventAt: "desc" }, { createdAt: "desc" }],
    select: { toState: true, toStrikes: true, pauseReason: true, coreFailureOpen: true, eventAt: true },
  });
  if (latest) return { state: latest.toState, strikes: latest.toStrikes, pauseReason: latest.pauseReason, coreFailureOpen: latest.coreFailureOpen, source: "decision", lastEventAt: latest.eventAt };
  const a = await db.ghlAccount.findUnique({ where: { id: ghlAccountId }, select: { billingState: true, warningCount: true, pauseReason: true } });
  return a ? seedFromAccount(a) : null;
}
