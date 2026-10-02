import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { EVENT_TABLE, executeRemoval, planRemoval, SPECS, unexpectedReferences } from "../removeMembers";

type Row = Record<string, any>;

/** where-evaluator: equality, {in}, {gt}, OR. Enough for the registry's queries. */
function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, c]) => {
    if (k === "OR") return (c as Row[]).some((w) => match(row, w));
    const v = row[k] ?? null;
    if (c !== null && typeof c === "object") {
      if ("in" in c) return c.in.includes(v);
      if ("gt" in c) return v !== null && Number(v) > Number(c.gt);
    }
    return v === c;
  });
}

/** In-memory db: one array per model delegate, generic count/findMany/findUnique/deleteMany/aggregate, transaction with rollback. */
function fakeDb(seed: Record<string, Row[]>, opts: { failOnDelete?: string } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const m of Prisma.dmmf.datamodel.models) tables[m.name[0].toLowerCase() + m.name.slice(1)] = [];
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const delegate = (name: string) => ({
    count: async ({ where }: Row) => tables[name].filter((r) => match(r, where)).length,
    findMany: async ({ where }: Row = {}) => tables[name].filter((r) => match(r, where)),
    findUnique: async ({ where }: Row) => tables[name].find((r) => match(r, where)) ?? null,
    deleteMany: async ({ where }: Row) => {
      if (opts.failOnDelete === name) throw new Error(`FK violation on ${name}`);
      const keep = tables[name].filter((r) => !match(r, where));
      const n = tables[name].length - keep.length;
      tables[name] = keep;
      return { count: n };
    },
    aggregate: async ({ where }: Row) => {
      const rows = tables[name].filter((r) => match(r, where));
      return { _count: { _all: rows.length }, _sum: { amount: rows.reduce((s, r) => s + Number(r.amount), 0) } };
    },
  });
  const db: Row = { tables };
  for (const name of Object.keys(tables)) db[name] = delegate(name);
  // GhlEvent raw lookup: ($queryRaw`... ANY(${ext}) ... LIKE ${pattern}`)
  db.$queryRaw = async (_s: TemplateStringsArray, ext: string[], pattern: string) => tables.ghlEvent.filter((e) => ext.includes(e.externalId) || JSON.stringify(e.payload).includes(pattern.replace(/%/g, ""))).map((e) => ({ id: e.id }));
  db.$transaction = async (fn: (tx: any) => Promise<unknown>) => {
    const snap = JSON.stringify(tables);
    try {
      return await fn(db);
    } catch (e) {
      const restored = JSON.parse(snap);
      for (const k of Object.keys(tables)) tables[k] = restored[k];
      throw e;
    }
  };
  return db as any;
}

const C = "CONTACT1abcd";
const LOC = "LOC_ONE";
const base = (): Record<string, Row[]> => ({
  user: [{ id: "U1", email: "a@x.test", role: "user", ghlContactId: C, ghlLocationId: LOC }, { id: "U2", email: "keep@x.test", role: "user", ghlContactId: "OTHERCONTACT9", ghlLocationId: "LOC_TWO" }],
  ghlAccount: [{ id: "A1", userId: "U1", contactId: C, locationId: LOC, accountType: "member" }, { id: "A2", userId: "U2", contactId: "OTHERCONTACT9", locationId: "LOC_TWO", accountType: "member" }],
  toolUse: [{ id: "T1", userId: "U1", locationId: LOC }, { id: "T2", userId: "U2", locationId: "LOC_TWO" }],
  apiCall: [{ id: "AC1", toolUseId: "T1", locationId: LOC }, { id: "AC2", toolUseId: null, locationId: LOC }, { id: "AC3", toolUseId: "T2", locationId: "LOC_TWO" }],
  ledgerEntry: [{ id: "L1", userId: "U1", toolUseId: "T1" }, { id: "L2", userId: "U2" }],
  creditHold: [{ id: "H1", userId: "U1", toolUseId: "T1" }],
  cart: [{ id: "CA1", userId: "U1" }, { id: "CA2", userId: "U2" }],
  cartLine: [{ id: "CL1", cartId: "CA1" }, { id: "CL2", cartId: "CA2" }],
  memberAction: [{ id: "M1", userId: "U1", cartId: "CA1" }],
  subscription: [{ id: "S1", userId: "U1" }, { id: "S2", userId: "U2" }],
  wallet: [{ id: "W1", userId: "U1" }, { id: "W2", userId: "U2" }],
  transaction: [{ id: "X1", userId: "U1", ghlLocationId: LOC }, { id: "X2", userId: "U2", ghlLocationId: "LOC_TWO" }],
  deal: [{ id: "D1", locationId: LOC }, { id: "D2", locationId: "LOC_TWO" }],
  landDeal: [{ id: "LD1", locationId: LOC }],
  ghlToken: [{ id: "G1", locationId: LOC }, { id: "G2", locationId: "LOC_TWO" }],
  walletBalanceSnapshot: [{ id: "WB1", ghlAccountId: "A1", locationId: LOC }, { id: "WB2", ghlAccountId: null, locationId: LOC }, { id: "WB3", ghlAccountId: "A2", locationId: "LOC_TWO" }],
  usageRollup: [{ id: "UR1", ghlAccountId: "A1", scopeKey: LOC }, { id: "UR2", ghlAccountId: null, scopeKey: LOC }, { id: "UR3", ghlAccountId: "A2", scopeKey: "LOC_TWO" }],
  walletTransaction: [{ id: "WT1", ghlAccountId: "A1", scopeKey: LOC }, { id: "WT2", ghlAccountId: "A2", scopeKey: "LOC_TWO" }],
  dunningDecision: [{ id: "DD1", ghlAccountId: "A1" }, { id: "DD2", ghlAccountId: "A2" }],
  ghlIntent: [{ id: "GI1", ghlAccountId: "A1" }, { id: "GI2", ghlAccountId: "A2" }],
  billingLedgerEntry: [
    { id: "B1", ghlTransactionId: "TXN1", ghlAccountId: "A1", contactId: C, status: "failed", amount: 99 },
    { id: "B2", ghlTransactionId: "TXN2", ghlAccountId: null, contactId: C, status: "succeeded", amount: 0 },
    { id: "B3", ghlTransactionId: "TXN3", ghlAccountId: "A2", contactId: "OTHERCONTACT9", status: "succeeded", amount: 99 },
  ],
  ghlSubscriptionState: [{ id: "SS1", subscriptionId: "SUB1", contactId: C }, { id: "SS2", subscriptionId: "SUB2", contactId: "OTHERCONTACT9" }],
  ghlEvent: [
    { id: "E1", externalId: C, payload: { stage: "x" } },
    { id: "E2", externalId: "TXN1", payload: {} },
    { id: "E3", externalId: "unrelated", payload: { contact: C } },
    { id: "E4", externalId: "TXN3", payload: { contact: "OTHERCONTACT9" } },
  ],
});
const count = (p: any, table: string) => p.counts.find((c: any) => c.table === table)?.count;

describe("planRemoval — dry-run counts every dependent row, across tables with and without FKs", () => {
  it("counts per table for the contact's User, GhlAccount, and everything hanging off them — and only theirs", async () => {
    const db = fakeDb(base());
    const p: any = await planRemoval(db, C);
    expect(p.ok).toBe(true);
    expect(p.ctx).toMatchObject({ userId: "U1", accountId: "A1", locationIds: [LOC], toolUseIds: ["T1"], cartIds: ["CA1"], ledgerTxnIds: ["TXN1", "TXN2"] });
    const want: Record<string, number> = {
      CreditHold: 1, ApiCall: 2, LedgerEntry: 1, ToolUse: 1, MemberAction: 1, CartLine: 1, Cart: 1, Subscription: 1, Wallet: 1, Transaction: 1,
      Deal: 1, LandDeal: 1, GhlToken: 1, WalletBalanceSnapshot: 2, UsageRollup: 2, WalletTransaction: 1, DunningDecision: 1, GhlIntent: 1,
      BillingLedgerEntry: 2, GhlSubscriptionState: 1, [EVENT_TABLE]: 3, GhlAccount: 1, User: 1,
    };
    for (const [t, n] of Object.entries(want)) expect(count(p, t), t).toBe(n);
    expect(p.total).toBe(Object.values(want).reduce((a, b) => a + b, 0));
  });
  it("a dry-run deletes nothing", async () => {
    const db = fakeDb(base());
    const before = JSON.stringify(db.tables);
    await planRemoval(db, C);
    expect(JSON.stringify(db.tables)).toBe(before);
  });
  it("a User with no GhlAccount is still found (by ghlContactId) and its account count is 0", async () => {
    const seed = base();
    seed.ghlAccount = seed.ghlAccount.filter((a) => a.id !== "A1");
    const p: any = await planRemoval(fakeDb(seed), C);
    expect(p.ok).toBe(true);
    expect(p.ctx.accountId).toBeNull();
    expect(count(p, "GhlAccount")).toBe(0);
    expect(count(p, "User")).toBe(1);
  });
});

describe("planRemoval — refusals", () => {
  it("any succeeded BillingLedgerEntry with amount > 0 → refused (money moved), by account OR contact", async () => {
    for (const row of [{ id: "B9", ghlTransactionId: "TXN9", ghlAccountId: "A1", contactId: null, status: "succeeded", amount: 0.5 }, { id: "B9", ghlTransactionId: "TXN9", ghlAccountId: null, contactId: C, status: "succeeded", amount: 99 }]) {
      const seed = base();
      seed.billingLedgerEntry.push(row);
      const p: any = await planRemoval(fakeDb(seed), C);
      expect(p.ok).toBe(false);
      expect(p.refusal.reason).toMatch(/money moved/);
    }
  });
  it("failed / zero-amount / refunded-to-zero-status rows alone do not block removal", async () => {
    expect((await planRemoval(fakeDb(base()), C) as any).ok).toBe(true);
  });
  it("unknown contact, bad id, ambiguous User, admin role, internal account, and a User/GhlAccount mismatch are all refused", async () => {
    const reasons = async (mut: (s: Record<string, Row[]>) => void, id = C) => { const s = base(); mut(s); const p: any = await planRemoval(fakeDb(s), id); return p.ok ? "OK" : p.refusal.reason; };
    expect(await reasons(() => {}, "NOSUCHCONTACT1")).toMatch(/no User or GhlAccount/);
    expect(await reasons(() => {}, "x y")).toMatch(/not a valid/);
    expect(await reasons((s) => s.user.push({ id: "U9", email: "d", role: "user", ghlContactId: C }))).toMatch(/ambiguous/);
    expect(await reasons((s) => { s.user[0].role = "admin"; })).toMatch(/not a plain member/);
    expect(await reasons((s) => { s.ghlAccount[0].accountType = "internal"; })).toMatch(/not member/);
    expect(await reasons((s) => { s.ghlAccount[0].userId = "U2"; })).toMatch(/different User/);
    expect(await reasons((s) => s.adminAction = [{ id: "AA1", adminUserId: "U1" }])).toMatch(/admin actions/);
  });
});

describe("executeRemoval — deletes dependents, then GhlAccount, then User, and nothing else", () => {
  it("removes exactly the member's rows; the other member's rows are untouched", async () => {
    const db = fakeDb(base());
    const p: any = await planRemoval(db, C);
    const deleted = await db.$transaction((tx: any) => executeRemoval(tx, p.ctx));
    const byTable = Object.fromEntries(deleted.map((d: any) => [d.table, d.deleted]));
    expect(byTable.User).toBe(1);
    expect(byTable.GhlAccount).toBe(1);
    expect(byTable.BillingLedgerEntry).toBe(2);
    expect(byTable[EVENT_TABLE]).toBe(3);
    // planned counts == deleted counts
    for (const c of p.counts) expect(byTable[c.table], c.table).toBe(c.count);
    const t = db.tables;
    expect(t.user.map((r: Row) => r.id)).toEqual(["U2"]);
    expect(t.ghlAccount.map((r: Row) => r.id)).toEqual(["A2"]);
    expect(t.toolUse.map((r: Row) => r.id)).toEqual(["T2"]);
    expect(t.apiCall.map((r: Row) => r.id)).toEqual(["AC3"]);
    expect(t.cart.map((r: Row) => r.id)).toEqual(["CA2"]);
    expect(t.cartLine.map((r: Row) => r.id)).toEqual(["CL2"]);
    expect(t.billingLedgerEntry.map((r: Row) => r.id)).toEqual(["B3"]);
    expect(t.ghlEvent.map((r: Row) => r.id)).toEqual(["E4"]);
    expect(t.ghlSubscriptionState.map((r: Row) => r.id)).toEqual(["SS2"]);
    expect(t.deal.map((r: Row) => r.id)).toEqual(["D2"]);
    expect(t.ghlToken.map((r: Row) => r.id)).toEqual(["G2"]);
  });
  it("deletes in child → parent order: dependents first, then GhlAccount, then User last", async () => {
    const order: string[] = [];
    const db = fakeDb(base());
    for (const k of Object.keys(db.tables)) { const orig = db[k].deleteMany; db[k].deleteMany = async (a: Row) => (order.push(k), orig(a)); }
    const p: any = await planRemoval(db, C);
    await executeRemoval(db, p.ctx);
    expect(order.slice(-2)).toEqual(["ghlAccount", "user"]);
    expect(order.indexOf("toolUse")).toBeGreaterThan(order.indexOf("apiCall"));
    expect(order.indexOf("toolUse")).toBeGreaterThan(order.indexOf("creditHold"));
    expect(order.indexOf("cart")).toBeGreaterThan(order.indexOf("cartLine"));
    expect(order.indexOf("cart")).toBeGreaterThan(order.indexOf("memberAction"));
    expect(order.indexOf("ghlAccount")).toBeGreaterThan(order.indexOf("billingLedgerEntry"));
  });
  it("a failure partway through rolls the WHOLE transaction back (nothing deleted)", async () => {
    const db = fakeDb(base(), { failOnDelete: "ghlAccount" });
    const before = JSON.stringify(db.tables);
    const p: any = await planRemoval(db, C);
    await expect(db.$transaction((tx: any) => executeRemoval(tx, p.ctx))).rejects.toThrow(/FK violation/);
    expect(JSON.stringify(db.tables)).toBe(before);
  });
  it("rows that survive the deletes (an unexpected reference) abort the transaction", async () => {
    const db = fakeDb(base());
    const p: any = await planRemoval(db, C);
    // simulate a concurrent writer: a new dependent row appears after the delete of that table
    const orig = db.deal.deleteMany;
    db.deal.deleteMany = async (a: Row) => { const r = await orig(a); db.tables.deal.push({ id: "D9", locationId: LOC }); return r; };
    const before = JSON.stringify(db.tables);
    await expect(db.$transaction((tx: any) => executeRemoval(tx, p.ctx))).rejects.toThrow(/rows remain in Deal/);
    expect(JSON.stringify(db.tables)).toBe(before); // rolled back, including the row that appeared mid-transaction
  });
});

describe("unexpectedReferences — the registry covers the real schema", () => {
  it("the actual Prisma schema has no model referencing User/GhlAccount that the registry misses", () => {
    expect(unexpectedReferences()).toEqual([]);
  });
  it("a relation added later is caught", () => {
    expect(unexpectedReferences([{ name: "NewThing", fields: [{ type: "User", relationFromFields: ["userId"] }] }])).toEqual(["NewThing"]);
    expect(unexpectedReferences([{ name: "NewThing", fields: [{ type: "GhlAccount", relationFromFields: ["ghlAccountId"] }] }])).toEqual(["NewThing"]);
    expect(unexpectedReferences([{ name: "Wallet", fields: [{ type: "User", relationFromFields: ["userId"] }] }])).toEqual([]);
  });
  it("every registry delegate exists on the Prisma client", () => {
    const models = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name[0].toLowerCase() + m.name.slice(1)));
    for (const s of SPECS) expect(models.has(s.delegate), s.delegate).toBe(true);
  });
});
