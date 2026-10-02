import { describe, expect, it } from "vitest";
import { ingestTransaction } from "../ingestTransaction";
import { locationIdFromDescription, shouldStampRefundDetected } from "../matchAccount";
import { parseSettlementTime, planUsageWindows, toWalletTransactionData } from "../usageRollup";
import { AUTO_DESC, MANUAL_DESC, listTxn, singleTxn } from "./fixtures";

type Row = Record<string, any>;

/** In-memory stand-in for the three Prisma delegates ingestTransaction touches. */
function fakeDb(accounts: { id: string; contactId: string; locationId: string | null }[]) {
  // ingestTransaction matches MEMBER accounts only; these fixtures are all members.
  const ledger = new Map<string, Row>();
  const db: any = {
    ghlAccount: {
      findFirst: async ({ where }: { where: { contactId?: string; locationId?: string; accountType?: string } }) => {
        expect(where.accountType).toBe("member");
        return accounts.find((a) => (where.contactId ? a.contactId === where.contactId : a.locationId === where.locationId)) ?? null;
      },
    },
    billingLedgerEntry: {
      findUnique: async ({ where }: { where: { ghlTransactionId: string } }) => ledger.get(where.ghlTransactionId) ?? null,
      upsert: async ({ where, create, update }: { where: { ghlTransactionId: string }; create: Row; update: Row }) => {
        const prev = ledger.get(where.ghlTransactionId);
        ledger.set(where.ghlTransactionId, prev ? { ...prev, ...update } : { refundDetectedAt: null, ...create });
      },
    },
  };
  return { db, ledger };
}

const T1 = new Date("2026-09-10T00:00:00.000Z");
const T2 = new Date("2026-09-11T00:00:00.000Z");
const member = { id: "acct_member", contactId: "cccccccccccccccccc09", locationId: "LOCATION0000000000002" };

describe("refundDetectedAt rule", () => {
  it("pure rule: only an increase, only when not already set", () => {
    expect(shouldStampRefundDetected(0, 10, null)).toBe(true);
    expect(shouldStampRefundDetected(0, 0, null)).toBe(false);
    expect(shouldStampRefundDetected(10, 10, null)).toBe(false);
    expect(shouldStampRefundDetected(0, 10, T1)).toBe(false);
  });

  it("stamps on the update that raises amountRefunded, and never overwrites it", async () => {
    const { db, ledger } = fakeDb([]);
    const id = "aaaaaaaaaaaaaaaaaaaaaaa9";
    await ingestTransaction(listTxn({ id, amount: 57, subscriptionId: "sub1" }), db, { now: T1 });
    expect(ledger.get(id)!.refundDetectedAt).toBeNull();

    const r = await ingestTransaction(singleTxn({ id, amount: 57, subscriptionId: "sub1", amountRefunded: 57, status: "refunded" }), db, { now: T1 });
    expect(r.action === "written" && r.refundDetected).toBe(true);
    expect(ledger.get(id)!.refundDetectedAt).toEqual(T1);

    await ingestTransaction(listTxn({ id, amount: 57, subscriptionId: "sub1", amountRefunded: 57, status: "refunded" }), db, { now: T2 });
    expect(ledger.get(id)!.refundDetectedAt).toEqual(T1);
  });

  it("leaves a row that already had a refund when first seen, and re-ingests without change, at null", async () => {
    const { db, ledger } = fakeDb([]);
    const id = "aaaaaaaaaaaaaaaaaaaaaab1";
    await ingestTransaction(listTxn({ id, amount: 15, subType: "saas_one_time", description: MANUAL_DESC, amountRefunded: 15, status: "refunded" }), db, { now: T1 });
    await ingestTransaction(listTxn({ id, amount: 15, subType: "saas_one_time", description: MANUAL_DESC, amountRefunded: 15, status: "refunded" }), db, { now: T2 });
    expect(ledger.get(id)!.refundDetectedAt).toBeNull();
  });
});

describe("auto-recharge description-URL fallback", () => {
  it("parses the member locationId from the description URL", () => {
    expect(locationIdFromDescription(AUTO_DESC)).toBe("LOCATION0000000000002");
    expect(locationIdFromDescription(MANUAL_DESC)).toBeNull();
    expect(locationIdFromDescription(null)).toBeNull();
  });

  it("matches by contactId first", async () => {
    const { db, ledger } = fakeDb([member]);
    const id = "aaaaaaaaaaaaaaaaaaaaaac1";
    const r = await ingestTransaction(listTxn({ id, amount: 10, subType: "saas_one_time", description: AUTO_DESC, contactId: member.contactId }), db);
    expect(r).toMatchObject({ action: "written", matchMethod: "contactId", matchedAccount: true });
    expect(ledger.get(id)!.ghlAccountId).toBe("acct_member");
  });

  it("falls back to the description location when the contact is unknown", async () => {
    const { db, ledger } = fakeDb([member]);
    const id = "aaaaaaaaaaaaaaaaaaaaaac2";
    const r = await ingestTransaction(listTxn({ id, amount: 10, subType: "saas_one_time", description: AUTO_DESC, contactId: "unknownunknownunknown" }), db);
    expect(r).toMatchObject({ classification: "wallet_auto_recharge", matchMethod: "descriptionLocation", matchedAccount: true });
    expect(ledger.get(id)!.ghlAccountId).toBe("acct_member");
  });

  it("stays unmatched when the URL location is not a member", async () => {
    const { db, ledger } = fakeDb([{ ...member, locationId: "SOMEOTHERLOCATION" }]);
    const id = "aaaaaaaaaaaaaaaaaaaaaac3";
    const r = await ingestTransaction(listTxn({ id, amount: 10, subType: "saas_one_time", description: AUTO_DESC, contactId: "unknownunknownunknown" }), db);
    expect(r).toMatchObject({ matchMethod: null, matchedAccount: false });
    expect(ledger.get(id)!.ghlAccountId).toBeNull();
  });

  it("does not apply to non-auto-recharge rows", async () => {
    const { db } = fakeDb([member]);
    const r = await ingestTransaction(
      listTxn({ id: "aaaaaaaaaaaaaaaaaaaaaac4", amount: 10, subType: "saas_one_time", description: "Manual Recharge /location/LOCATION0000000000002/", contactId: "unknownunknownunknown" }),
      db,
    );
    expect(r).toMatchObject({ classification: "wallet_manual_recharge", matchMethod: null });
  });
});

describe("wallet usage helpers", () => {
  it("builds a WalletTransaction payload with rollup-consistent rounding and category", () => {
    const d = toWalletTransactionData({ id: "w1", description: "Outbound SMS: Ref-a", amount: -0.0079, settlementTime: "2026-08-01T10:00:00.000Z" }, "LOC1", "acct1");
    expect(d).toMatchObject({ id: "w1", scopeKey: "LOC1", ghlAccountId: "acct1", category: "outbound_sms", description: "Outbound SMS: Ref-a" });
    expect(d.amount.toFixed(6)).toBe("-0.007900");
    expect(d.settlementTime.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  it("parses GHL's zoneless settlementTime as UTC regardless of machine timezone", () => {
    expect(parseSettlementTime("2026-06-19 08:06:55.147").toISOString()).toBe("2026-06-19T08:06:55.147Z");
    expect(parseSettlementTime("2026-06-19T23:59:59.999Z").toISOString()).toBe("2026-06-19T23:59:59.999Z");
    expect(parseSettlementTime("2026-06-19T23:00:00-06:00").toISOString()).toBe("2026-06-20T05:00:00.000Z");
    const d = toWalletTransactionData({ id: "w2", description: "A2P Registration (1)", amount: -15, settlementTime: "2026-06-18 17:54:46.213" }, "LOC1", null);
    expect(d.settlementTime.toISOString().slice(0, 10)).toBe("2026-06-18"); // same day as the rollup's slice(0,10)
  });

  it("plans 1 window normally and previous-month weekly windows only on UTC day 3", () => {
    expect(planUsageWindows(new Date("2026-09-26T05:00:00Z"))).toHaveLength(1);
    expect(planUsageWindows(new Date("2026-09-02T05:00:00Z"))).toHaveLength(1);
    const w = planUsageWindows(new Date("2026-09-03T05:00:00Z"));
    expect(w).toHaveLength(1 + 5); // August: 31 days = 4 full weeks + 3 days
    expect(w[1].from).toBe("2026-08-01T00:00:00.000Z");
    expect(w[5].to).toBe("2026-08-31T23:59:59.999Z");
    for (let i = 2; i < w.length; i++) expect(Date.parse(w[i].from)).toBe(Date.parse(w[i - 1].to) + 1); // contiguous, no gaps/overlap
  });

  it("January run covers December of the previous year", () => {
    const w = planUsageWindows(new Date("2027-01-03T05:00:00Z"));
    expect(w[1].from).toBe("2026-12-01T00:00:00.000Z");
    expect(w[w.length - 1].to).toBe("2026-12-31T23:59:59.999Z");
  });
});
