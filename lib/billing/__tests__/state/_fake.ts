import { Prisma } from "@prisma/client";

type Row = Record<string, any>;

/** Tiny `where` matcher: equality, {in}, {not: null}, {lte}/{gte}/{lt}/{gt}, NOT. Enough for the queries the engine/sweep make. */
export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k] ?? null;
    if (cond === undefined) return true;
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond && !cond.in.includes(v)) return false;
      if ("not" in cond) { if (cond.not === null ? v === null : v === cond.not) return false; }
      if ("lte" in cond && !(v !== null && v <= cond.lte)) return false;
      if ("lt" in cond && !(v !== null && v < cond.lt)) return false;
      if ("gte" in cond && !(v !== null && v >= cond.gte)) return false;
      if ("gt" in cond && !(v !== null && v > cond.gt)) return false;
      return true;
    }
    return v === cond;
  });
}
export type FakeAccount = { id: string; accountType: "member" | "internal"; locationId: string | null; coreCoveredUntil: Date | null; billingState: any; warningCount: number; pauseReason: any; contactId?: string; trialOffer?: string | null; trialEndsAt?: Date | null; userId?: string; onboardingStage?: string | null; onboardingProgress?: string | null; activeClientSince?: Date | null };

/**
 * In-memory stand-in for the delegates the engine touches. `ghlAccount` deliberately has NO update/updateMany/create: a shadow run
 * that tried to write account state would throw a TypeError and fail the test.
 */
export function makeFake(accounts: FakeAccount[], ledger: Row[] = [], opts: { writable?: boolean; users?: Row[] } = {}) {
  const decisions: Row[] = [];
  const jobRuns = new Map<string, Row>();
  const intents: Row[] = [];
  const events: Row[] = [];
  const subStates: Row[] = [];
  const users: Row[] = opts.users ?? [];
  const writes: string[] = [];
  let seq = 0;
  let iseq = 0;
  const key = (r: Row) => `${r.trigger}|${r.ghlAccountId}|${r.mode}`;
  const db: any = {
    decisions,
    jobRuns,
    intents,
    events,
    subStates,
    users,
    writes,
    ghlIntent: {
      create: async ({ data }: any) => {
        if (intents.some((i) => i.dedupeKey === data.dedupeKey)) throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        const row = { id: `i${++iseq}`, attempts: 0, lastError: null, sentAt: null, createdAt: new Date(Date.UTC(2026, 8, 27, 1, 0, iseq)), ...data };
        intents.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => intents.find((i) => (where.id ? i.id === where.id : i.dedupeKey === where.dedupeKey)) ?? null,
      findMany: async ({ where, take }: any) => intents.filter((i) => where.status.in.includes(i.status) && i.attempts < where.attempts.lt && (!where.id || where.id.in.includes(i.id)) && (!where.dedupeKey?.startsWith || String(i.dedupeKey).startsWith(where.dedupeKey.startsWith)) && (!where.OR || where.OR.some((c: any) => String(i.dedupeKey).startsWith(c.dedupeKey.startsWith)))).slice(0, take ?? 999),
      update: async ({ where, data }: any) => {
        const row = intents.find((i) => i.id === where.id)!;
        for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in (v as any) ? (row[k] ?? 0) + (v as any).increment : v;
        return row;
      },
    },
    ghlEvent: {
      create: async ({ data }: any) => {
        const row = { id: `e${events.length + 1}`, attempts: 0, processedAt: null, lastError: null, receivedAt: data.receivedAt ?? new Date(), externalId: null, ...data };
        events.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => events.find((e) => e.id === where.id) ?? null,
      findMany: async ({ where, take, orderBy }: any) => {
        const f = events.filter((e) => matches(e, { ...where, id: undefined, receivedAt: undefined }) && (!where.id?.not || e.id !== where.id.not) && (!where.receivedAt?.gte || e.receivedAt >= where.receivedAt.gte));
        if (orderBy?.receivedAt === "desc") f.sort((a, b) => b.receivedAt - a.receivedAt || (a.id < b.id ? 1 : -1));
        return f.slice(0, take ?? 999);
      },
      update: async ({ where, data }: any) => {
        const row = events.find((e) => e.id === where.id)!;
        for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && !(v instanceof Date) && "increment" in (v as any) ? (row[k] ?? 0) + (v as any).increment : v;
        return row;
      },
    },
    ghlSubscriptionState: {
      count: async () => subStates.length,
      findUnique: async ({ where }: any) => subStates.find((r) => r.subscriptionId === where.subscriptionId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const row = subStates.find((r) => r.subscriptionId === where.subscriptionId);
        if (row) Object.assign(row, update); else subStates.push({ ...create });
      },
    },
    ghlAccount: {
      findUnique: async ({ where }: any) => accounts.find((a) => a.id === where.id) ?? null,
      findFirst: async ({ where }: any) => accounts.find((a) => matches(a, where)) ?? null,
      findMany: async ({ where }: any) => accounts.filter((a) => matches(a, where)),
      // read-only unless the test opts in (live mode): a shadow run that tried to write state would throw a TypeError here
      ...(opts.writable ? { update: async ({ where, data }: any) => { writes.push(`ghlAccount.update ${JSON.stringify(data)}`); Object.assign(accounts.find((a) => a.id === where.id)!, data); } } : {}),
      ...(opts.writable ? { updateMany: async ({ where, data }: any) => { const hit = accounts.filter((x) => matches(x, where)); for (const x of hit) { writes.push(`ghlAccount.updateMany ${JSON.stringify(data)}`); Object.assign(x, data); } return { count: hit.length }; } } : {}),
    },
    ...(opts.writable ? { user: { updateMany: async ({ where, data }: any) => { writes.push(`user.updateMany ${JSON.stringify(data)}`); const u = users.find((x) => x.id === where.id); if (u && (!where.status || where.status.in.includes(u.status))) Object.assign(u, data); return { count: u ? 1 : 0 }; } } } : {}),
    billingLedgerEntry: {
      findUnique: async ({ where }: any) => ledger.find((r) => r.ghlTransactionId === where.ghlTransactionId) ?? null,
      findFirst: async ({ where, orderBy }: any) => {
        const f = ledger.filter((r) => matches(r, { ...where, occurredAt: undefined }) && (!where.occurredAt?.gte || r.occurredAt >= where.occurredAt.gte));
        if (orderBy?.occurredAt === "asc") f.sort((a, b) => a.occurredAt - b.occurredAt);
        return f[0] ?? null;
      },
    },
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
      update: async ({ where, data }: any) => {
        const row = decisions.find((d) => d.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    jobRun: {
      findUnique: async ({ where }: any) => jobRuns.get(where.job) ?? null,
      upsert: async ({ where, create, update }: any) => { jobRuns.set(where.job, { ...(jobRuns.get(where.job) ?? create), ...(jobRuns.has(where.job) ? update : {}) }); },
    },
    $queryRaw: async () => [{ locked: 1 }],
    // Snapshot/restore so a throwing transaction leaves NOTHING behind (atomicity is testable).
    // Transactions run one at a time (the real code serializes per account with pg_advisory_xact_lock).
    $transaction: (fn: any) => (txChain = txChain.then(() => runTx(fn), () => runTx(fn))),
  };
  let txChain: Promise<unknown> = Promise.resolve();
  const runTx = async (fn: any) => {
      const snap = { d: [...decisions], i: [...intents], a: accounts.map((x) => ({ ...x })), u: users.map((x) => ({ ...x })), w: [...writes] };
      try {
        return await fn(db);
      } catch (e) {
        decisions.splice(0, decisions.length, ...snap.d);
        intents.splice(0, intents.length, ...snap.i);
        accounts.forEach((x, idx) => Object.assign(x, snap.a[idx]));
        users.forEach((x, idx) => Object.assign(x, snap.u[idx]));
        writes.splice(0, writes.length, ...snap.w);
        throw e;
      }
  };
  return db;
}

export const member = (o: Partial<FakeAccount> = {}): FakeAccount => ({ id: "A1", accountType: "member", locationId: "LOC_A1", coreCoveredUntil: null, billingState: "active", warningCount: 0, pauseReason: null, contactId: "CONTACT_A1", trialOffer: null, trialEndsAt: null, userId: "U1", onboardingStage: null, onboardingProgress: null, activeClientSince: new Date("2026-09-01T00:00:00Z"), ...o }); // handed off by default (Clients routing); pass activeClientSince: null for an onboarding member
export const NOW = new Date("2026-09-27T12:00:00.000Z");
export const hoursAgo = (h: number, from = NOW) => new Date(from.getTime() - h * 3600 * 1000);
export const negBal = async () => ({ status: "ok" as const, value: "-3.000000", estimated: false });
export const posBal = async () => ({ status: "ok" as const, value: "8.000000", estimated: false });
export const ledgerRow = (o: Row): Row => ({ ghlTransactionId: "tx1", classification: "wallet_auto_recharge", status: "failed", ghlAccountId: "A1", occurredAt: hoursAgo(1), subscriptionId: null, ...o });
