import type { PrismaClient } from "@prisma/client";

/**
 * One-time backfill for GhlAccount.setupFeeStatus. Existing members never owed an OP setup fee: every member account with a null
 * status becomes NOT_REQUIRED. Optionally (paidContactIds) the named members — matched by HQ contact id — are set to PAID from any
 * state. Dry-run by default; idempotent (a second run changes nothing). No GHL calls. The CLI is scripts/billing/backfill-setup-fee-status.ts.
 */
export type SetupFeeBackfillReport = {
  /** Member accounts with a null setupFeeStatus (what step 1 changes). */
  nullMembers: number;
  /** Step 1 rows written (apply only). */
  notRequiredSet: number;
  paid: {
    requested: number;
    /** Member accounts matched by contact id. */
    matched: number;
    /** Requested contact ids with no member account (nothing written for these). */
    missing: string[];
    alreadyPaid: number;
    /** Rows that are (or, in dry-run, would be) newly set to PAID. */
    toSet: number;
    applied: number;
  };
};

type Db = Pick<PrismaClient, "ghlAccount">;
export const CONTACT_ID_RE = /^[A-Za-z0-9]{8,64}$/;

export async function runSetupFeeBackfill(db: Db, opts: { apply: boolean; paidContactIds?: string[] }): Promise<SetupFeeBackfillReport> {
  const ids = [...new Set(opts.paidContactIds ?? [])];
  const bad = ids.filter((c) => !CONTACT_ID_RE.test(c));
  if (bad.length) throw new Error(`not a valid GHL contact id: ${bad.map((b) => `…${b.slice(-4)}`).join(", ")}`);

  const report: SetupFeeBackfillReport = { nullMembers: await db.ghlAccount.count({ where: { accountType: "member", setupFeeStatus: null } }), notRequiredSet: 0, paid: { requested: ids.length, matched: 0, missing: [], alreadyPaid: 0, toSet: 0, applied: 0 } };

  const matched = ids.length ? await db.ghlAccount.findMany({ where: { accountType: "member", contactId: { in: ids } }, select: { id: true, contactId: true, setupFeeStatus: true } }) : [];
  const found = new Set(matched.map((m) => m.contactId));
  report.paid.matched = matched.length;
  report.paid.missing = ids.filter((c) => !found.has(c));
  report.paid.alreadyPaid = matched.filter((m) => m.setupFeeStatus === "PAID").length;
  report.paid.toSet = matched.length - report.paid.alreadyPaid;

  if (opts.apply) {
    // Step 1 first, then step 2: a listed member that was null ends PAID, not NOT_REQUIRED.
    report.notRequiredSet = (await db.ghlAccount.updateMany({ where: { accountType: "member", setupFeeStatus: null }, data: { setupFeeStatus: "NOT_REQUIRED" } })).count;
    if (matched.length) report.paid.applied = (await db.ghlAccount.updateMany({ where: { id: { in: matched.map((m) => m.id) }, setupFeeStatus: { not: "PAID" } }, data: { setupFeeStatus: "PAID" } })).count;
  }
  return report;
}
