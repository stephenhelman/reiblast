import { Prisma } from "@prisma/client";

type Row = Record<string, any>;
export type FakeAccount = { id: string; accountType: "member" | "internal"; locationId: string | null; coreCoveredUntil: Date | null; billingState: any; warningCount: number; pauseReason: any };

/**
 * In-memory stand-in for the delegates the engine touches. `ghlAccount` deliberately has NO update/updateMany/create: a shadow run
 * that tried to write account state would throw a TypeError and fail the test.
 */
export function makeFake(accounts: FakeAccount[], ledger: Row[] = []) {
  const decisions: Row[] = [];
  const jobRuns = new Map<string, Row>();
  let seq = 0;
  const key = (r: Row) => `${r.trigger}|${r.ghlAccountId}|${r.mode}`;
  const db: any = {
    decisions,
    jobRuns,
    ghlAccount: { findUnique: async ({ where }: any) => accounts.find((a) => a.id === where.id) ?? null },
    billingLedgerEntry: { findUnique: async ({ where }: any) => ledger.find((r) => r.ghlTransactionId === where.ghlTransactionId) ?? null },
    dunningDecision: {
      findUnique: async ({ where }: any) => {
        const w = where.trigger_ghlAccountId_mode;
        return decisions.find((d) => key(d) === `${w.trigger}|${w.ghlAccountId}|${w.mode}`) ?? null;
      },
      findFirst: async ({ where }: any) => {
        const found = decisions.filter((d) => d.ghlAccountId === where.ghlAccountId && d.mode === where.mode);
        found.sort((a, b) => b.eventAt - a.eventAt || b.createdAt - a.createdAt);
        return found[0] ?? null;
      },
      create: async ({ data }: any) => {
        if (decisions.some((d) => key(d) === key(data))) throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        const row = { id: `d${++seq}`, createdAt: new Date(Date.UTC(2026, 8, 27, 0, 0, seq)), ...data };
        decisions.push(row);
        return row;
      },
    },
    jobRun: {
      findUnique: async ({ where }: any) => jobRuns.get(where.job) ?? null,
      upsert: async ({ where, create, update }: any) => { jobRuns.set(where.job, { ...(jobRuns.get(where.job) ?? create), ...(jobRuns.has(where.job) ? update : {}) }); },
    },
    $queryRaw: async () => [{ locked: 1 }],
    $transaction: async (fn: any) => fn(db),
  };
  return db;
}

export const member = (o: Partial<FakeAccount> = {}): FakeAccount => ({ id: "A1", accountType: "member", locationId: "LOC_A1", coreCoveredUntil: null, billingState: "active", warningCount: 0, pauseReason: null, ...o });
export const NOW = new Date("2026-09-27T12:00:00.000Z");
export const hoursAgo = (h: number, from = NOW) => new Date(from.getTime() - h * 3600 * 1000);
export const negBal = async () => ({ status: "ok" as const, value: "-3.000000", estimated: false });
export const posBal = async () => ({ status: "ok" as const, value: "8.000000", estimated: false });
export const ledgerRow = (o: Row): Row => ({ ghlTransactionId: "tx1", classification: "wallet_auto_recharge", status: "failed", ghlAccountId: "A1", occurredAt: hoursAgo(1), subscriptionId: null, ...o });
