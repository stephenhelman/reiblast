/**
 * SQL integration tests for the cost queries, on SYNTHETIC rows only.
 *
 * Each test runs in ONE interactive transaction that creates a TEMP TABLE named "WalletTransaction" — it shadows the real
 * table for that connection (the queries use unqualified names), the synthetic rows go into the temp table, and the
 * transaction is ALWAYS rolled back. No real billing data is read or written. The suite skips itself unless
 * REPORTS_TEST_DATABASE_URL is set (npm run test:reports-db); it refuses the production host.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { costCells, costDetailChunks, costDetailPage, costGroupOf, scopeClassOf, summarizeCosts, usageByScope, usageSince, type CostFilters } from "../../reports/costs";
import { walletPage } from "../../reports/evidence";
import { sumOf } from "../../reports/money";

const URL = process.env.REPORTS_TEST_DATABASE_URL;
const HQ = "LOC_HQ";

type W = { id: string; scope: string; at: string; cat: string; amt: string; desc?: string };
const rows: W[] = [
  // August (Denver) — the categories/scopes from the real ledger shape
  { id: "w01", scope: "LOC_M1", at: "2026-08-15T12:00:00.000Z", cat: "outbound_sms", amt: "-100" },
  { id: "w02", scope: "LOC_M1", at: "2026-08-16T12:00:00.000Z", cat: "a2p_registration", amt: "-15" },
  { id: "w03", scope: "LOC_M2", at: "2026-08-17T12:00:00.000Z", cat: "sms_carrier_fee", amt: "-50.5" },
  { id: "w04", scope: HQ, at: "2026-08-18T12:00:00.000Z", cat: "phone_number_monthly", amt: "-12" },
  { id: "w05", scope: "_agency", at: "2026-08-19T12:00:00.000Z", cat: "agency_auto_recharge", amt: "961.196233" },
  { id: "w06", scope: "_agency", at: "2026-08-20T12:00:00.000Z", cat: "agency_manual_recharge", amt: "50" },
  { id: "w07", scope: "_agency", at: "2026-08-21T12:00:00.000Z", cat: "wallet_sales_tax", amt: "-55.04" },
  { id: "w08", scope: "_agency", at: "2026-08-22T12:00:00.000Z", cat: "email_notification", amt: "-0.415125" },
  { id: "w09", scope: "_unattributed", at: "2026-08-23T12:00:00.000Z", cat: "email", amt: "-0.002025" },
  { id: "w10", scope: "LOC_M1", at: "2026-08-24T12:00:00.000Z", cat: "outbound_sms", amt: "0.5" }, // a credit
  // Denver month boundaries (MDT = UTC−6): Aug 1 00:00 MDT = 06:00Z; Sep 1 00:00 MDT = 06:00Z
  { id: "b01", scope: "LOC_M1", at: "2026-08-01T05:59:59.999Z", cat: "outbound_sms", amt: "-3" }, // July 31 23:59 MDT → July
  { id: "b02", scope: "LOC_M1", at: "2026-08-01T06:00:00.000Z", cat: "outbound_sms", amt: "-4" }, // August
  { id: "b03", scope: "LOC_M1", at: "2026-09-01T05:59:59.999Z", cat: "outbound_sms", amt: "-1" }, // Aug 31 23:59 MDT → August
  { id: "b04", scope: "LOC_M1", at: "2026-09-01T06:00:00.000Z", cat: "outbound_sms", amt: "-2" }, // September
  // Two rows sharing one timestamp, to exercise keyset ties
  { id: "t01", scope: "LOC_M2", at: "2026-08-25T12:00:00.000Z", cat: "inbound_sms", amt: "-0.01" },
  { id: "t02", scope: "LOC_M2", at: "2026-08-25T12:00:00.000Z", cat: "inbound_sms", amt: "-0.02" },
  { id: "t03", scope: "LOC_M2", at: "2026-08-25T12:00:00.000Z", cat: "inbound_sms", amt: "-0.03" },
];

const prisma = URL ? new PrismaClient({ datasourceUrl: URL }) : null;
if (URL && URL.includes("ep-restless-silence")) throw new Error("REPORTS_TEST_DATABASE_URL points at the production host — refusing.");
afterAll(async () => void (await prisma?.$disconnect()));

class Rollback<T> extends Error {
  constructor(public result: T) {
    super("rollback");
  }
}

async function withTemp<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>, data: W[] = rows): Promise<T> {
  try {
    await (prisma as PrismaClient).$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE "WalletTransaction" (LIKE public."WalletTransaction" INCLUDING DEFAULTS) ON COMMIT DROP`);
        const check = await tx.$queryRawUnsafe<{ t: string | null }[]>(`SELECT to_regclass('pg_temp."WalletTransaction"')::text AS t`);
        if (!check[0]?.t) throw new Error("temp table was not created — aborting before any insert");
        for (const r of data) {
          await tx.$executeRaw`INSERT INTO "WalletTransaction" ("id","scopeKey","ghlAccountId","settlementTime","category","description","amount") VALUES (${r.id}, ${r.scope}, ${null}, ${r.at}::timestamp, ${r.cat}, ${r.desc ?? `${r.cat} synthetic`}, ${r.amt}::numeric)`;
        }
        throw new Rollback(await fn(tx));
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
  } catch (e) {
    if (e instanceof Rollback) return e.result as T;
    throw e;
  }
  throw new Error("unreachable");
}

const RANGE: CostFilters = { fromMonth: "2026-07", toMonth: "2026-09" };

describe.skipIf(!URL)("cost SQL on synthetic rows (temp table, rolled back)", () => {
  it("never touches the real table", async () => {
    const before = await (prisma as PrismaClient).$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM public."WalletTransaction"`);
    await withTemp(async (tx) => tx.$queryRawUnsafe(`SELECT COUNT(*) FROM "WalletTransaction"`));
    const after = await (prisma as PrismaClient).$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM public."WalletTransaction"`);
    expect(String(after[0].n)).toBe(String(before[0].n));
    const leftover = await (prisma as PrismaClient).$queryRawUnsafe<{ t: string | null }[]>(`SELECT to_regclass('pg_temp."WalletTransaction"')::text AS t`);
    expect(leftover[0].t).toBeNull();
  });

  it("buckets by the DENVER month of settlementTime (boundaries, DST-independent here)", async () => {
    const cells = await withTemp((tx) => costCells(tx, { ...RANGE, category: "outbound_sms", scope: "member" }, HQ));
    const by = Object.fromEntries(cells.map((c) => [c.month, c.stored]));
    expect(by["2026-07"]).toBe("-3.000000"); //   Aug 1 05:59:59.999Z is still July in Denver
    expect(by["2026-08"]).toBe("-104.500000"); // -100 +0.5 credit -4 -1  (Sep 1 05:59:59.999Z is still August)
    expect(by["2026-09"]).toBe("-2.000000");
  });

  it("classifies scope (member / hq / agency / unattributed) and group exactly like the TS mapping", async () => {
    const cells = await withTemp((tx) => costCells(tx, RANGE, HQ));
    for (const c of cells) {
      expect(c.group).toBe(costGroupOf(c.category));
      const scopes = rows.filter((r) => r.cat === c.category).map((r) => scopeClassOf(r.scope, HQ));
      expect(scopes).toContain(c.scope);
    }
    const aug = summarizeCosts(cells.filter((c) => c.month === "2026-08"));
    expect(aug.byScope.hq.ongoing).toBe("12.000000");
    expect(aug.byScope.agency.agency_cash).toBe("1011.196233");
    expect(aug.byScope.agency.tax).toBe("55.040000");
    expect(aug.byScope.agency.ongoing).toBe("0.415125"); // email_notification on the agency scope is ongoing usage, not agency cash
    expect(aug.byScope.unattributed.ongoing).toBe("0.002025");
    expect(aug.byScope.member.one_time).toBe("15.000000");
  });

  it("without an HQ configured nothing is classified as HQ", async () => {
    const cells = await withTemp((tx) => costCells(tx, { ...RANGE, category: "phone_number_monthly" }, null));
    expect(cells.map((c) => c.scope)).toEqual(["member"]);
  });

  it("AGGREGATE == DETAIL: for every cell, the detail rows sum to the cell and count to its count", async () => {
    const out = await withTemp(async (tx) => {
      const cells = await costCells(tx, RANGE, HQ);
      const checks: { cell: (typeof cells)[number]; count: number; sum: string }[] = [];
      for (const c of cells) {
        const f: CostFilters = { ...RANGE, month: c.month, scope: c.scope, category: c.category };
        const got: { amount: string }[] = [];
        for await (const chunk of costDetailChunks(tx, f, HQ)) got.push(...chunk);
        checks.push({ cell: c, count: got.length, sum: sumOf(got.map((g) => g.amount)) });
      }
      return checks;
    });
    expect(out.length).toBeGreaterThan(8);
    for (const { cell, count, sum } of out) {
      expect(count).toBe(cell.count);
      expect(sum).toBe(cell.stored);
    }
  });

  it("group filters partition the rows: one_time + ongoing + agency_cash + tax == everything", async () => {
    const totals = await withTemp(async (tx) => {
      const all = await costCells(tx, RANGE, HQ);
      const parts = await Promise.all((["one_time", "ongoing", "agency_cash", "tax"] as const).map((group) => costCells(tx, { ...RANGE, group }, HQ)));
      return { all: all.reduce((n, c) => n + c.count, 0), parts: parts.map((p) => p.reduce((n, c) => n + c.count, 0)), allSum: sumOf(all.map((c) => c.stored)), partSum: sumOf(parts.flat().map((c) => c.stored)) };
    });
    expect(totals.parts.reduce((a, b) => a + b, 0)).toBe(totals.all);
    expect(totals.partSum).toBe(totals.allSum);
    expect(totals.all).toBe(rows.length);
  });

  it("keyset pagination walks every row once, newest first, across timestamp ties", async () => {
    const seen = await withTemp(async (tx) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 50; guard++) {
        const page: Awaited<ReturnType<typeof costDetailPage>> = await costDetailPage(tx, RANGE, HQ, cursor);
        ids.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return ids;
    });
    expect(new Set(seen).size).toBe(rows.length);
    expect(seen.length).toBe(rows.length);
    const expected = [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1)).map((r) => r.id);
    expect(seen).toEqual(expected);
  });

  it("small page sizes cross the tie group without skipping or repeating", async () => {
    const seen = await withTemp(async (tx) => {
      const ids: string[] = [];
      let cursor: import("../../reports/evidence").Cursor | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const page: Awaited<ReturnType<typeof walletPage>> = await walletPage(tx, (await import("../../reports/costs")).costWhere({ ...RANGE, month: "2026-08" }, HQ), cursor, 2);
        ids.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        const [t, ...rest] = Buffer.from(page.nextCursor, "base64url").toString().split("|");
        cursor = { t, id: rest.join("|") };
      }
      return ids;
    });
    const aug = rows.filter((r) => r.at >= "2026-08-01T06:00:00.000Z" && r.at < "2026-09-01T06:00:00.000Z");
    expect(seen.length).toBe(aug.length);
    expect(new Set(seen).size).toBe(aug.length);
  });

  it("member usage per scope excludes HQ / agency / unattributed and shows charges positive", async () => {
    const m = await withTemp((tx) => usageByScope(tx, { fromMonth: "2026-08", toMonth: "2026-08" }, HQ));
    expect([...m.keys()].sort()).toEqual(["LOC_M1", "LOC_M2"]);
    expect(m.get("LOC_M1")?.cost).toBe("119.500000"); // 100 + 15 + 4 + 1 − 0.5 credit
    expect(m.get("LOC_M2")?.cost).toBe("50.560000"); // 50.5 + 0.01 + 0.02 + 0.03
  });

  it("rolling window usage (members list) counts only member scope since the cutoff", async () => {
    const m = await withTemp((tx) => usageSince(tx, new Date("2026-08-24T00:00:00Z"), HQ));
    expect(m.get("LOC_M1")?.cost).toBe("2.500000"); // +0.5 credit −1 −2 on/after Aug 24
    expect(m.get("LOC_M2")?.cost).toBe("0.060000");
    expect([...m.keys()]).not.toContain(HQ);
  });

  it("scopeKey, category and month filters narrow the same query", async () => {
    const r = await withTemp(async (tx) => ({
      m1: await costCells(tx, { ...RANGE, scopeKey: "LOC_M1", month: "2026-08" }, HQ),
      none: await costCells(tx, { ...RANGE, scopeKey: "NOPE" }, HQ),
    }));
    expect(new Set(r.m1.map((c) => c.scope))).toEqual(new Set(["member"]));
    expect(r.none).toEqual([]);
  });

  it("parameters are bound, not concatenated (a hostile value matches nothing and breaks nothing)", async () => {
    const cells = await withTemp((tx) => costCells(tx, { ...RANGE, category: "x'; DROP TABLE \"WalletTransaction\"; --" }, HQ));
    expect(cells).toEqual([]);
  });
});
