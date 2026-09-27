import { describe, expect, it } from "vitest";
import type { BillingClass } from "@prisma/client";
import { byTimeDescIdDesc, decodeCursor, encodeCursor, pageOf, type Page } from "../../reports/evidence";
import { aggregateAttempts, aggregateRevenue, attemptsDetail, computeEras, eraMonths, isAttempt, isRevenue, netOf, providerLabel, refundNote, revenueDetail, revenueFromRows, type LedgerRow } from "../../reports/revenue";

let n = 0;
const row = (o: Partial<LedgerRow> & { at: string; cls: BillingClass; amount: string }): LedgerRow => ({
  ghlTransactionId: o.ghlTransactionId ?? `tx${String(++n).padStart(4, "0")}`,
  occurredAt: new Date(o.at),
  classification: o.cls,
  status: o.status ?? "succeeded",
  amount: o.amount,
  amountRefunded: o.amountRefunded ?? "0.000000",
  provider: o.provider ?? "authorize-net",
  ghlAccountId: o.ghlAccountId === undefined ? "acct1" : o.ghlAccountId,
  refundDetectedAt: o.refundDetectedAt ?? null,
  subscriptionId: null,
  classifierVersion: 2,
});

const RANGE = { fromMonth: "2026-06", toMonth: "2026-09" };

describe("revenue rule: net = amount − amountRefunded over succeeded + refunded", () => {
  it("counts succeeded rows at face value", () => {
    const r = aggregateRevenue([row({ at: "2026-07-10T12:00:00Z", cls: "core_subscription", amount: "57" })], "2026-06", "2026-09");
    expect(r.totals.net).toBe("57.000000");
    expect(r.rows.find((m) => m.month === "2026-07")?.byClass.core_subscription).toEqual({ net: "57.000000", count: 1 });
  });

  it("a fully refunded row (status refunded, refunded = amount) nets to zero but is still a row", () => {
    const r = aggregateRevenue([row({ at: "2026-08-04T12:00:00Z", cls: "wallet_manual_recharge", status: "refunded", amount: "15", amountRefunded: "15" })], "2026-06", "2026-09");
    expect(r.totals.net).toBe("0.000000");
    expect(r.totals.count).toBe(1);
  });

  it("a partial refund on a succeeded row nets the difference", () => {
    const rows = [row({ at: "2026-08-04T12:00:00Z", cls: "core_subscription", amount: "57", amountRefunded: "20" })];
    expect(aggregateRevenue(rows, "2026-06", "2026-09").totals.net).toBe("37.000000");
    expect(netOf(rows[0])).toBe("37.000000");
  });

  it("failed, pending, trial_auth (even succeeded $0) and failed_signup are NOT revenue", () => {
    const rows = [
      row({ at: "2026-08-04T12:00:00Z", cls: "core_subscription", status: "failed", amount: "57" }),
      row({ at: "2026-08-04T12:00:00Z", cls: "wallet_auto_recharge", status: "pending", amount: "10" }),
      row({ at: "2026-08-04T12:00:00Z", cls: "trial_auth", status: "succeeded", amount: "0" }),
      row({ at: "2026-08-04T12:00:00Z", cls: "failed_signup", status: "failed", amount: "57" }),
      row({ at: "2026-08-04T12:00:00Z", cls: "core_subscription", amount: "57" }),
    ];
    expect(rows.map(isRevenue)).toEqual([false, false, false, false, true]);
    expect(aggregateRevenue(rows, "2026-06", "2026-09").totals).toMatchObject({ net: "57.000000", count: 1 });
  });

  it("a succeeded unclassified row lands in the Other column, so the total never drops a row", () => {
    const r = aggregateRevenue([row({ at: "2026-08-04T12:00:00Z", cls: "unclassified", amount: "12.5" }), row({ at: "2026-08-05T12:00:00Z", cls: "core_subscription", amount: "57" })], "2026-06", "2026-09");
    expect(r.totals.byClass.other).toEqual({ net: "12.500000", count: 1 });
    expect(r.totals.net).toBe("69.500000");
  });

  it("sums exactly (no float drift)", () => {
    const rows = Array.from({ length: 10 }, () => row({ at: "2026-08-04T12:00:00Z", cls: "wallet_auto_recharge", amount: "0.1" }));
    expect(aggregateRevenue(rows, "2026-06", "2026-09").totals.net).toBe("1.000000");
  });
});

describe("Denver month bucketing and ranges", () => {
  it("assigns by the Denver month of occurredAt, not UTC", () => {
    const rows = [
      row({ at: "2026-09-01T05:59:59.999Z", cls: "core_subscription", amount: "57" }), // Aug 31 23:59 MDT → August
      row({ at: "2026-09-01T06:00:00.000Z", cls: "core_subscription", amount: "100" }), // Sep 1 00:00 MDT → September
    ];
    const r = aggregateRevenue(rows, "2026-06", "2026-09");
    expect(r.rows.find((m) => m.month === "2026-08")?.net).toBe("57.000000");
    expect(r.rows.find((m) => m.month === "2026-09")?.net).toBe("100.000000");
  });
  it("zero-fills every month in range and ignores rows outside it", () => {
    const r = aggregateRevenue([row({ at: "2026-05-15T12:00:00Z", cls: "core_subscription", amount: "57" }), row({ at: "2026-10-15T12:00:00Z", cls: "core_subscription", amount: "57" })], "2026-06", "2026-09");
    expect(r.rows.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(r.totals.net).toBe("0.000000");
  });
});

describe("every aggregate cell drills down to exactly its rows", () => {
  const ledger = [
    row({ at: "2026-06-10T12:00:00Z", cls: "core_subscription", amount: "57", provider: "stripe" }),
    row({ at: "2026-06-11T12:00:00Z", cls: "wallet_auto_recharge", amount: "10.5", provider: "stripe" }),
    row({ at: "2026-07-10T12:00:00Z", cls: "wallet_manual_recharge", amount: "100", amountRefunded: "40", provider: "stripe" }),
    row({ at: "2026-08-06T12:00:00Z", cls: "core_subscription", amount: "57", provider: "square" }),
    row({ at: "2026-08-20T12:00:00Z", cls: "wallet_auto_recharge", amount: "10.01", provider: "authorize-net", ghlAccountId: null }),
    row({ at: "2026-09-02T12:00:00Z", cls: "unclassified", amount: "3" }),
    row({ at: "2026-09-02T12:00:00Z", cls: "core_subscription", status: "failed", amount: "57" }),
  ];
  it("for each month × class, detail rows == count and net", () => {
    const agg = aggregateRevenue(ledger, "2026-06", "2026-09");
    for (const m of agg.rows) for (const [k, cell] of Object.entries(m.byClass)) {
      const d = revenueDetail(ledger, { ...RANGE, month: m.month, klass: k as never });
      expect(d.length).toBe(cell.count);
      expect(d.reduce((s, r) => s + Number(r.net), 0)).toBeCloseTo(Number(cell.net), 6);
    }
  });
  it("all detail rows == totals; ids list matches", () => {
    const { totals, ids } = revenueFromRows(ledger, { ...RANGE });
    const all = revenueDetail(ledger, RANGE);
    expect(all.length).toBe(totals.count);
    expect(ids).toEqual(all.map((r) => r.ghlTransactionId));
    expect(all.reduce((s, r) => s + Number(r.net), 0)).toBeCloseTo(Number(totals.net), 6);
  });
  it("provider and unmatched-account filters narrow the same rows", () => {
    expect(revenueDetail(ledger, { ...RANGE, provider: "stripe" }).length).toBe(3);
    expect(revenueDetail(ledger, { ...RANGE, accountId: "unmatched" }).map((r) => r.provider)).toEqual(["authorize-net"]);
    expect(revenueDetail(ledger, { ...RANGE, accountId: "acct1" }).length).toBe(5);
  });
  it("eras and per-month processor mix come from the provider on each row", () => {
    const eras = computeEras(ledger);
    expect(eras.map((e) => [e.provider, e.count])).toEqual([["stripe", 3], ["square", 1], ["authorize-net", 3]]);
    expect(eras[0].label).toBe("GHL processor: stripe");
    const aug = aggregateRevenue(ledger, "2026-06", "2026-09").rows.find((m) => m.month === "2026-08")!;
    expect(eraMonths(aug)).toEqual(["authorize-net", "square"]);
    expect(providerLabel("stripe")).toBe("GHL processor: stripe");
    expect(providerLabel(null)).toBe("GHL processor: unknown");
  });
});

describe("attempts are exactly the rows that are not revenue", () => {
  const ledger = [
    row({ at: "2026-08-04T12:00:00Z", cls: "core_subscription", status: "failed", amount: "57" }),
    row({ at: "2026-08-05T12:00:00Z", cls: "core_subscription", status: "failed", amount: "57" }),
    row({ at: "2026-08-06T12:00:00Z", cls: "trial_auth", amount: "0" }),
    row({ at: "2026-08-07T12:00:00Z", cls: "failed_signup", status: "failed", amount: "57" }),
    row({ at: "2026-08-08T12:00:00Z", cls: "wallet_auto_recharge", status: "pending", amount: "10" }),
    row({ at: "2026-08-09T12:00:00Z", cls: "core_subscription", amount: "57" }),
  ];
  it("revenue and attempts partition the ledger (no row in both, none in neither)", () => {
    expect(ledger.every((r) => isRevenue(r) !== isAttempt(r))).toBe(true);
    expect(ledger.filter(isRevenue).length + ledger.filter(isAttempt).length).toBe(ledger.length);
  });
  it("aggregates by class × status with gross amounts and matching ids", () => {
    const a = aggregateAttempts(ledger, RANGE);
    expect(a.rows).toEqual([
      { classification: "core_subscription", status: "failed", count: 2, amount: "114.000000" },
      { classification: "failed_signup", status: "failed", count: 1, amount: "57.000000" },
      { classification: "trial_auth", status: "succeeded", count: 1, amount: "0.000000" },
      { classification: "wallet_auto_recharge", status: "pending", count: 1, amount: "10.000000" },
    ]);
    expect(a.totals).toEqual({ count: 5, amount: "181.000000" });
    expect(a.ids.length).toBe(5);
    expect(attemptsDetail(ledger, { ...RANGE, classification: "core_subscription", status: "failed" }).length).toBe(2);
    expect(attemptsDetail(ledger, RANGE).map((r) => r.ghlTransactionId).sort()).toEqual([...a.ids].sort());
  });
});

describe("refund note", () => {
  it("blank when nothing refunded; date when detected; 'predates tracking' when refunded but undated", () => {
    expect(refundNote({ amountRefunded: "0.000000", refundDetectedAt: null })).toBe("");
    expect(refundNote({ amountRefunded: "15.000000", refundDetectedAt: null })).toBe("predates tracking");
    expect(refundNote({ amountRefunded: "15.000000", refundDetectedAt: new Date("2026-09-20T10:00:00Z") })).toBe("detected 2026-09-20");
  });
});

describe("keyset pagination", () => {
  const rows = Array.from({ length: 25 }, (_, i) => row({ ghlTransactionId: `id${String(i).padStart(3, "0")}`, at: `2026-08-${String(1 + Math.floor(i / 3)).padStart(2, "0")}T12:00:00Z`, cls: "core_subscription", amount: "1" })); // 3 rows share each timestamp
  const key = (r: LedgerRow) => ({ t: r.occurredAt.toISOString(), id: r.ghlTransactionId });
  const sorted = [...rows].sort(byTimeDescIdDesc(key));

  it("cursor round-trips and rejects garbage", () => {
    const c = { t: "2026-08-01T12:00:00.000Z", id: "a|b" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("!!!")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
  it("walking pages visits every row exactly once, newest first, stable across timestamp ties", () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page: Page<LedgerRow> = pageOf(sorted, key, decodeCursor(cursor), 4);
      seen.push(...page.rows.map((r) => r.ghlTransactionId));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(sorted.map((r) => r.ghlTransactionId));
    expect(new Set(seen).size).toBe(25);
  });
  it("a cursor past the end returns nothing", () => {
    expect(pageOf(sorted, key, { t: "2000-01-01T00:00:00.000Z", id: "zzz" }, 4).rows).toEqual([]);
  });
});
