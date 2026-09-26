import { describe, expect, it } from "vitest";
import { normalizeTransaction } from "../normalizeTransaction";
import { AUTO_DESC, listTxn, singleTxn } from "./fixtures";

describe("normalizeTransaction", () => {
  const opts = { subType: "saas_one_time", entityType: "manual", description: AUTO_DESC, amount: 12.5, subscriptionId: "sub00000000000000001" };

  it("list and single shapes normalize to the same result", () => {
    expect(normalizeTransaction(listTxn(opts))).toEqual(normalizeTransaction(singleTxn(opts)));
  });

  it("reads the nested entitySource on the single shape", () => {
    const n = normalizeTransaction(singleTxn(opts));
    expect(n.entitySourceSubType).toBe("saas_one_time");
    expect(n.description).toBe(AUTO_DESC);
    expect(n.provider).toBe("authorize-net");
    expect(n.subscriptionId).toBe("sub00000000000000001");
  });

  it("reads entitySourceType from both shapes", () => {
    expect(normalizeTransaction(listTxn({ sourceType: "payment_link" })).entitySourceType).toBe("payment_link");
    expect(normalizeTransaction(singleTxn({ sourceType: "payment_link" })).entitySourceType).toBe("payment_link");
  });

  it("unwraps an array of one", () => {
    expect(normalizeTransaction(singleTxn()).id).toBe("aaaaaaaaaaaaaaaaaaaaaaa1");
  });

  it("occurredAt prefers fulfilledAt, falls back to createdAt", () => {
    expect(normalizeTransaction(listTxn()).occurredAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(normalizeTransaction(listTxn({ fulfilledAt: null })).occurredAt.toISOString()).toBe("2026-09-01T11:59:59.000Z");
  });

  it("falls back to chargeSnapshot.order.description", () => {
    const r = { ...listTxn({ subType: "saas_one_time" }), entitySourceMeta: {}, chargeSnapshot: { order: { description: AUTO_DESC } } };
    expect(normalizeTransaction(r).description).toBe(AUTO_DESC);
  });

  it("keeps amountRefunded and defaults it to 0", () => {
    expect(normalizeTransaction(listTxn({ amountRefunded: 57 })).amountRefunded).toBe(57);
    const r = listTxn() as Record<string, unknown>;
    delete r.amountRefunded;
    expect(normalizeTransaction(r).amountRefunded).toBe(0);
  });

  it("throws on unusable input", () => {
    expect(() => normalizeTransaction(null)).toThrow();
    expect(() => normalizeTransaction([])).toThrow();
    expect(() => normalizeTransaction({ amount: 1 })).toThrow(/_id/);
  });
});
