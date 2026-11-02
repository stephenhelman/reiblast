import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { claimFounderSlot, claimFounderSlotTx, getClaimView } from "../claim";
import { countSlotsTaken, isSlotHeld, slotsLeftFrom } from "../slots";

type Row = Record<string, any>;
const NOW = new Date("2026-10-29T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const ENV = { FOUNDER_CLAIMS_OPEN_AT: "2026-10-29T00:00:00Z", FOUNDER_CLAIMS_CLOSE_AT: "2026-11-01T04:59:59Z", FOUNDER_INTENTS: "live", GHL_INTENT_URL_FOUNDER: "https://hook/f", GHL_HQ_LOCATION_ID: "HQ" };

function makeDb(opts: { now?: Date; accounts?: Row[]; claims?: Row[]; subs?: Row[] } = {}) {
  const now = opts.now ?? NOW;
  const accounts = opts.accounts ?? [acct("A1")];
  const claims: Row[] = (opts.claims ?? []).map((c) => ({ ...c }));
  const intents: Row[] = [];
  const subs = opts.subs ?? [];
  const locks: string[] = [];
  const match = (r: Row, w: Row = {}) => Object.entries(w).every(([k, c]) => (c && typeof c === "object" && "in" in c ? c.in.includes(r[k]) : r[k] === c));
  const db: any = {
    claims, intents, locks,
    $queryRaw: async (s: TemplateStringsArray) => {
      if (s[0].includes("pg_advisory_xact_lock")) { locks.push(s[0]); return [{ locked: 1 }]; }
      return [{ now }];
    },
    $transaction: async (fn: any, o: any) => { db.txOptions = o; return fn(db); },
    ghlAccount: {
      findUnique: async ({ where }: Row) => accounts.find((a) => a.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: Row) => accounts.find((a) => a.id === where.id)!,
    },
    ghlSubscriptionState: { findMany: async ({ where }: Row) => subs.filter((s) => s.contactId === where.contactId) },
    founderClaim: {
      findUnique: async ({ where }: Row) => claims.find((c) => c.ghlAccountId === where.ghlAccountId) ?? null,
      findFirst: async ({ where }: Row) => claims.find((c) => match(c, where)) ?? null,
      findMany: async ({ where }: Row) => claims.filter((c) => match(c, where)),
      aggregate: async () => ({ _max: { claimNumber: claims.length ? Math.max(...claims.map((c) => c.claimNumber)) : null } }),
      create: async ({ data }: Row) => {
        if (claims.some((c) => c.claimNumber === data.claimNumber || c.ghlAccountId === data.ghlAccountId)) throw new Error("unique");
        const r = { id: `FC${claims.length + 1}`, attempt: 1, intentSentAt: null, ...data }; claims.push(r); return r;
      },
      update: async ({ where, data }: Row) => { const r = claims.find((c) => c.id === where.id)!; Object.assign(r, data); return r; },
      updateMany: async ({ where, data }: Row) => { const r = claims.find((c) => c.id === where.id && c.intentSentAt === where.intentSentAt); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; },
    },
    ghlIntent: {
      create: async ({ data }: Row) => {
        if (intents.some((i) => i.dedupeKey === data.dedupeKey)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" });
        const r = { id: `I${intents.length + 1}`, attempts: 0, ...data }; intents.push(r); return r;
      },
      findUnique: async ({ where }: Row) => intents.find((i) => i.id === where.id || i.dedupeKey === where.dedupeKey) ?? null,
      update: async ({ where, data }: Row) => { const r = intents.find((i) => i.id === where.id)!; for (const [k, v] of Object.entries<any>(data)) r[k] = v && typeof v === "object" && "increment" in v ? r[k] + v.increment : v; return r; },
    },
  };
  return db;
}
const acct = (id: string, over: Row = {}): Row => ({ id, contactId: `HQ_${id}`, accountType: "member", billingState: "active", setupFeeStatus: "PAID", user: { status: "active", email: `${id}@x.test`, name: "Ada Lovelace", businessPhone: "+15550001111" }, ...over });
const claim = (n: number, status: string, hrs = 1, over: Row = {}): Row => ({ id: `FC${n}`, token: `t${n}`, ghlAccountId: `X${n}`, claimNumber: n, status, isFirst: status === "FREE_WINNER", attempt: 1, claimedAt: hoursAgo(hrs), ...over });

describe("slot hold rule", () => {
  it("FREE_WINNER and PAID hold forever; PENDING holds 25h exactly; RELEASED never", () => {
    expect(isSlotHeld({ status: "FREE_WINNER", claimedAt: hoursAgo(500) }, NOW)).toBe(true);
    expect(isSlotHeld({ status: "PAID", claimedAt: hoursAgo(500) }, NOW)).toBe(true);
    expect(isSlotHeld({ status: "PENDING_PAYMENT", claimedAt: hoursAgo(24.99) }, NOW)).toBe(true);
    expect(isSlotHeld({ status: "PENDING_PAYMENT", claimedAt: hoursAgo(25) }, NOW)).toBe(false);
    expect(isSlotHeld({ status: "PENDING_PAYMENT", claimedAt: hoursAgo(26) }, NOW)).toBe(false);
    expect(isSlotHeld({ status: "RELEASED", claimedAt: hoursAgo(1) }, NOW)).toBe(false);
  });
  it("countSlotsTaken / slotsLeftFrom", async () => {
    const db = makeDb({ claims: [claim(1, "FREE_WINNER"), claim(2, "PAID", 90), claim(3, "PENDING_PAYMENT", 2), claim(4, "PENDING_PAYMENT", 30), claim(5, "RELEASED")] });
    expect(await countSlotsTaken(db)).toBe(3);
    expect(slotsLeftFrom(3)).toBe(7);
    expect(slotsLeftFrom(12)).toBe(0);
  });
});

describe("claimFounderSlotTx", () => {
  it("takes the advisory lock first, with explicit tx options", async () => {
    const db = makeDb();
    await claimFounderSlotTx(db, "A1", ENV);
    expect(db.locks[0]).toContain("hashtext('founder_claim')");
    expect(db.txOptions).toEqual({ timeout: 15000, maxWait: 5000 });
  });
  it("first claim is the free winner (claimNumber 1, FREE_WINNER); the second is PENDING with number 2", async () => {
    const db = makeDb({ accounts: [acct("A1"), acct("A2")] });
    const a: any = await claimFounderSlotTx(db, "A1", ENV);
    const b: any = await claimFounderSlotTx(db, "A2", ENV);
    expect(a.claim).toMatchObject({ status: "FREE_WINNER", isFirst: true, claimNumber: 1 });
    expect(b.claim).toMatchObject({ status: "PENDING_PAYMENT", isFirst: false, claimNumber: 2 });
    expect(db.claims.filter((c: Row) => c.isFirst)).toHaveLength(1);
    expect(new Set(db.claims.map((c: Row) => c.claimNumber)).size).toBe(2);
    expect(db.claims[0].token).not.toBe(db.claims[1].token);
    expect(db.intents.map((i: Row) => i.dedupeKey)).toEqual(["founder:FC1:1", "founder:FC2:1"]);
  });
  it("an existing FREE_WINNER / PENDING / PAID claim is returned unchanged, no new row or intent", async () => {
    for (const status of ["FREE_WINNER", "PENDING_PAYMENT", "PAID"]) {
      const db = makeDb({ claims: [claim(1, status, 1, { ghlAccountId: "A1" })] });
      const out: any = await claimFounderSlotTx(db, "A1", ENV);
      expect(out.result, status).toBe("existing");
      expect(out.claim).toMatchObject({ status, token: "t1", claimNumber: 1 });
      expect(db.claims).toHaveLength(1);
      expect(db.intents).toHaveLength(0);
    }
  });
  it("reopens a RELEASED claim in place: attempt+1, new token and number, cleared invoice, fresh claimedAt, new intent key", async () => {
    const db = makeDb({ claims: [claim(1, "FREE_WINNER"), claim(2, "RELEASED", 40, { ghlAccountId: "A1", invoiceId: "inv1", invoiceUrl: "https://x", intentSentAt: hoursAgo(39), releasedAt: hoursAgo(10) })] });
    const out: any = await claimFounderSlotTx(db, "A1", ENV);
    expect(out.result).toBe("claimed");
    expect(db.claims).toHaveLength(2);
    expect(db.claims[1]).toMatchObject({ id: "FC2", attempt: 2, status: "PENDING_PAYMENT", isFirst: false, claimNumber: 3, invoiceId: null, invoiceUrl: null, intentSentAt: null, releasedAt: null, claimedAt: NOW });
    expect(db.claims[1].token).not.toBe("t2");
    expect(db.intents[0].dedupeKey).toBe("founder:FC2:2");
  });
  it("sold out at 10 held slots; an expired (>25h) pending hold frees one", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => claim(i + 1, i === 0 ? "FREE_WINNER" : "PENDING_PAYMENT", 3));
    expect(((await claimFounderSlotTx(makeDb({ claims: ten }), "A1", ENV)) as any).result).toBe("sold_out");
    const nine = ten.slice(0, 9);
    expect(((await claimFounderSlotTx(makeDb({ claims: nine }), "A1", ENV)) as any).result).toBe("claimed");
    const stale = ten.map((c, i) => (i === 5 ? { ...c, claimedAt: hoursAgo(26) } : c));
    expect(((await claimFounderSlotTx(makeDb({ claims: stale }), "A1", ENV)) as any).result).toBe("claimed");
    const edge = ten.map((c, i) => (i === 5 ? { ...c, claimedAt: hoursAgo(24.9) } : c));
    expect(((await claimFounderSlotTx(makeDb({ claims: edge }), "A1", ENV)) as any).result).toBe("sold_out");
  });
  it("sold out writes nothing", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => claim(i + 1, "PAID", 3));
    const db = makeDb({ claims: ten });
    await claimFounderSlotTx(db, "A1", ENV);
    expect(db.claims).toHaveLength(10);
    expect(db.intents).toHaveLength(0);
  });
  it("window enforced inside the tx: before open, at open, at close", async () => {
    const at = (iso: string) => makeDb({ now: new Date(iso) });
    expect(await claimFounderSlotTx(at("2026-10-28T23:59:59.999Z"), "A1", ENV)).toEqual({ result: "not_open", window: "before" });
    expect(((await claimFounderSlotTx(at("2026-10-29T00:00:00.000Z"), "A1", ENV)) as any).result).toBe("claimed");
    expect(await claimFounderSlotTx(at("2026-11-01T04:59:59.000Z"), "A1", ENV)).toEqual({ result: "not_open", window: "closed" });
  });
  it("eligibility re-checked inside the tx", async () => {
    const db = makeDb({ accounts: [acct("A1", { setupFeeStatus: "PENDING" })] });
    expect(await claimFounderSlotTx(db, "A1", ENV)).toEqual({ result: "ineligible", reason: "setup_fee" });
    expect(db.claims).toHaveLength(0);
    expect(await claimFounderSlotTx(makeDb({ accounts: [] }), "A1", ENV)).toEqual({ result: "ineligible", reason: "not_member" });
    const ended = makeDb({ subs: [{ contactId: "HQ_A1", status: "canceled" }] });
    expect(await claimFounderSlotTx(ended, "A1", ENV)).toEqual({ result: "ineligible", reason: "subscription_ended" });
  });
  it("FOUNDER_INTENTS unset: the intent is recorded as skipped_shadow", async () => {
    const db = makeDb();
    await claimFounderSlotTx(db, "A1", { ...ENV, FOUNDER_INTENTS: undefined });
    expect(db.intents[0].status).toBe("skipped_shadow");
  });
});

describe("claimFounderSlot (after commit)", () => {
  const fetchIdentity = async () => null;
  it("sends inline to the founder URL and stamps intentSentAt", async () => {
    const db = makeDb();
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    const out: any = await claimFounderSlot(db, "A1", ENV, { send: { post }, fetchIdentity });
    expect(out.result).toBe("claimed");
    expect(post).toHaveBeenCalledWith("https://hook/f", expect.objectContaining({ hqContactId: "HQ_A1", isFirst: "true", amount: "0" }));
    expect(db.claims[0].intentSentAt).toBeInstanceOf(Date);
  });
  it("a failing send does not change the outcome and leaves intentSentAt null", async () => {
    const db = makeDb();
    const out: any = await claimFounderSlot(db, "A1", ENV, { send: { post: async () => { throw new Error("down"); } }, fetchIdentity });
    expect(out.result).toBe("claimed");
    expect(db.claims[0].intentSentAt).toBeNull();
    expect(db.intents[0].status).toBe("failed");
  });
  it("getClaimView hides RELEASED", async () => {
    const db = makeDb({ claims: [claim(1, "RELEASED", 1, { ghlAccountId: "A1" }), claim(2, "PAID", 1, { ghlAccountId: "A2" })] });
    expect(await getClaimView(db, "A1")).toBeNull();
    expect(await getClaimView(db, "A2")).toMatchObject({ status: "PAID" });
    expect(await getClaimView(db, "A3")).toBeNull();
  });
});
