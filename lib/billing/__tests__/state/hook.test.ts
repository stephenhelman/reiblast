import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_DESC, listTxn } from "../fixtures";

const TXN_ID = "aaaaaaaaaaaaaaaaaaaaaae1";
let payload: unknown;

vi.mock("../../ghlTransactions", () => ({ fetchTransactionById: vi.fn(async () => payload) }));
// No network in tests: the wallet client reports "unavailable", so the engine sees an unknown balance.
const walletCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../ghlWallet", async (orig) => ({ ...(await orig<typeof import("../../ghlWallet")>()), walletBalance: vi.fn(async () => (walletCalls.n++, { status: "unavailable" as const, balance: null, raw: {} })) }));

import { processPaymentEvent } from "../../processPaymentEvent";

/** Just enough of the Prisma surface for processPaymentEvent + ingestTransaction + the shadow hook. */
function fakeDb(opts: { dunningExplodes?: boolean } = {}) {
  const ledger: Record<string, any> = {};
  const decisions: any[] = [];
  const events: Record<string, any> = { ev1: { id: "ev1", externalId: TXN_ID, processedAt: null, attempts: 0 } };
  const jobRuns = new Map<string, any>();
  const db: any = {
    ledger, decisions, events, jobRuns,
    ghlEvent: {
      findUnique: async ({ where }: any) => events[where.id] ?? null,
      update: async ({ where, data }: any) => { Object.assign(events[where.id], data.attempts && typeof data.attempts === "object" ? { ...data, attempts: events[where.id].attempts + 1 } : data); },
      findMany: async () => [],
    },
    ghlAccount: {
      findFirst: async ({ where }: any) => (where.contactId === "cccccccccccccccccc01" ? { id: "A1" } : null),
      findUnique: async () => ({ id: "A1", accountType: "member", contactId: "cccccccccccccccccc01", locationId: "LOC1", coreCoveredUntil: null, trialOffer: null, trialEndsAt: null, userId: "U1", billingState: "active", warningCount: 0, pauseReason: null }),
    },
    billingLedgerEntry: {
      findUnique: async ({ where, select }: any) => {
        if (select && "classification" in select && opts.dunningExplodes) throw new Error("dunning read failed");
        return ledger[where.ghlTransactionId] ?? null;
      },
      upsert: async ({ where, create, update }: any) => { ledger[where.ghlTransactionId] = { ...(ledger[where.ghlTransactionId] ?? create), ...(ledger[where.ghlTransactionId] ? update : {}), ghlTransactionId: where.ghlTransactionId }; },
    },
    ghlIntent: { create: async ({ data }: any) => data },
    dunningDecision: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }: any) => { decisions.push(data); return data; },
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

beforeEach(() => {
  walletCalls.n = 0;
  // A FAILED auto-recharge for a matched member, "now" so the shadow freshness window accepts it.
  payload = listTxn({ id: TXN_ID, amount: 10, status: "failed", subType: "saas_one_time", description: AUTO_DESC, contactId: "cccccccccccccccccc01", fulfilledAt: new Date().toISOString() });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("processPaymentEvent → shadow dunning hook", () => {
  it("ingests the row, marks the event processed, then records a shadow decision (wallet balance unavailable in tests → strike not counted)", async () => {
    const db = fakeDb();
    const r = await processPaymentEvent("ev1", { db, retryPending: false });
    expect(r).toBe("processed");
    expect(db.ledger[TXN_ID]).toMatchObject({ classification: "wallet_auto_recharge", status: "failed" });
    expect(db.events.ev1.processedAt).toBeInstanceOf(Date);
    expect(db.decisions).toHaveLength(1);
    expect(db.decisions[0]).toMatchObject({ trigger: `ledger:${TXN_ID}`, mode: "shadow", eventKind: "wallet_recharge_failed", ghlAccountId: "A1", toStrikes: 0 });
    expect(db.decisions[0].reason).toMatch(/balance unknown \(wallet unavailable\); strike not counted/);
    expect(walletCalls.n).toBe(1); // the (mocked) agency wallet client was asked exactly once
  });

  it("a failing shadow hook changes NOTHING: still 'processed', ledger written, event processed, error recorded", async () => {
    const db = fakeDb({ dunningExplodes: true });
    const r = await processPaymentEvent("ev1", { db, retryPending: false });
    expect(r).toBe("processed");
    expect(db.ledger[TXN_ID]).toBeDefined();
    expect(db.events.ev1.processedAt).toBeInstanceOf(Date);
    expect(db.events.ev1.lastError ?? null).toBeNull();
    expect(db.decisions).toHaveLength(0);
    expect(db.jobRuns.get("dunning_shadow")).toMatchObject({ lastError: expect.stringMatching(/dunning read failed/) });
  });

  it("an unsupported DUNNING_MODE is contained: the ledger write and event still complete", async () => {
    const prev = process.env.DUNNING_MODE;
    process.env.DUNNING_MODE = "bogus";
    try {
      const db = fakeDb();
      expect(await processPaymentEvent("ev1", { db, retryPending: false })).toBe("processed");
      expect(db.ledger[TXN_ID]).toBeDefined();
      expect(db.decisions).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.DUNNING_MODE; else process.env.DUNNING_MODE = prev;
    }
  });

  it("reprocessing the same event is idempotent for the ledger and never doubles the decision", async () => {
    const db = fakeDb();
    await processPaymentEvent("ev1", { db, retryPending: false });
    expect(await processPaymentEvent("ev1", { db, retryPending: false })).toBe("already_processed");
    expect(db.decisions).toHaveLength(1);
  });
});
