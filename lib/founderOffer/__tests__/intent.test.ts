import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { sendPendingIntents } from "@/lib/billing/intents/send";
import { buildFounderPayload, enqueueFounderIntent, founderDedupeKey, founderIntentsMode, mergeHqIdentity, sendFounderIntentInline, splitName } from "../intent";

type Row = Record<string, any>;
function makeDb() {
  const rows: Row[] = [];
  const claims: Row[] = [{ id: "C1", intentSentAt: null }];
  const db: any = {
    rows,
    claims,
    ghlIntent: {
      create: async ({ data }: any) => {
        if (rows.some((r) => r.dedupeKey === data.dedupeKey)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" });
        const r = { id: `i${rows.length + 1}`, attempts: 0, ...data };
        rows.push(r);
        return r;
      },
      findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.dedupeKey === where.dedupeKey) ?? null,
      findMany: async ({ where }: any) =>
        rows
          .filter((r) => where.status.in.includes(r.status) && r.attempts < where.attempts.lt && (!where.OR || where.OR.some((c: any) => r.dedupeKey.startsWith(c.dedupeKey.startsWith))))
          .map((r) => ({ id: r.id })),
      update: async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries<any>(data)) r[k] = v && typeof v === "object" && "increment" in v ? r[k] + v.increment : v;
        return r;
      },
    },
    founderClaim: { updateMany: async ({ where, data }: any) => { const c = claims.find((x) => x.id === where.id && x.intentSentAt === where.intentSentAt); if (c) Object.assign(c, data); return { count: c ? 1 : 0 }; } },
  };
  return db;
}

const src = (over: Partial<{ attempt: number; isFirst: boolean }> = {}) => ({
  claim: { id: "C1", token: "tok", claimNumber: 3, isFirst: over.isFirst ?? false, attempt: over.attempt ?? 1 },
  account: { id: "A1", contactId: "HQC1" },
  user: { email: "a@x.test", name: "Ada Q Lovelace", businessPhone: "+15551234567" },
});
const LIVE = { FOUNDER_INTENTS: "live", GHL_INTENT_URL_FOUNDER: "https://hook/founder", GHL_HQ_LOCATION_ID: "HQLOC" };

describe("payload", () => {
  it("is all strings with the agreed keys", () => {
    const p = buildFounderPayload(src(), LIVE);
    expect(p).toEqual({ intent: "founders_offer", promo: "founders-2026", claimToken: "tok", claimNumber: "3", isFirst: "false", amount: "100", hqContactId: "HQC1", hqLocationId: "HQLOC", email: "a@x.test", phone: "+15551234567", firstName: "Ada", lastName: "Q Lovelace" });
    expect(Object.values(p).every((v) => typeof v === "string")).toBe(true);
  });
  it("first founder: isFirst true, amount 0", () => {
    expect(buildFounderPayload(src({ isFirst: true }), LIVE)).toMatchObject({ isFirst: "true", amount: "0" });
  });
  it("splitName / mergeHqIdentity keep DB values where HQ lacks them", () => {
    expect(splitName(null)).toEqual({ firstName: "", lastName: "" });
    const p = buildFounderPayload(src(), LIVE);
    expect(mergeHqIdentity(p, { firstName: "Ada", lastName: null, email: null, phone: "+1999" })).toMatchObject({ lastName: "Q Lovelace", email: "a@x.test", phone: "+1999" });
    expect(mergeHqIdentity(p, null)).toBe(p);
  });
});

describe("enqueueFounderIntent", () => {
  it("mode: only 'live' is live", () => {
    expect(founderIntentsMode({ FOUNDER_INTENTS: "live" })).toBe("live");
    expect(founderIntentsMode({})).toBe("shadow");
    expect(founderIntentsMode({ FOUNDER_INTENTS: "LIVE" })).toBe("shadow");
  });
  it("dedupe key includes the attempt; same attempt dedupes, a reopen (attempt 2) is a new row", async () => {
    const db = makeDb();
    expect(founderDedupeKey("C1", 1)).toBe("founder:C1:1");
    const a = await enqueueFounderIntent(db, src(), LIVE);
    const b = await enqueueFounderIntent(db, src(), LIVE);
    const c = await enqueueFounderIntent(db, src({ attempt: 2 }), LIVE);
    expect([a.created, b.created, c.created]).toEqual([true, false, true]);
    expect(b.id).toBe(a.id);
    expect(db.rows.map((r: Row) => r.dedupeKey)).toEqual(["founder:C1:1", "founder:C1:2"]);
    expect(db.rows[0]).toMatchObject({ pipeline: "founder", kind: "founder", status: "pending" });
  });
  it("shadow: recorded as skipped_shadow and never sent", async () => {
    const db = makeDb();
    await enqueueFounderIntent(db, src(), { GHL_HQ_LOCATION_ID: "HQLOC" });
    expect(db.rows[0].status).toBe("skipped_shadow");
    const post = vi.fn();
    expect(await sendFounderIntentInline(db, { intentId: "i1", claimId: "C1", contactId: "HQC1", env: {}, send: { post } })).toBe("off");
    expect(post).not.toHaveBeenCalled();
    expect(db.claims[0].intentSentAt).toBeNull();
  });
});

describe("sendFounderIntentInline (live)", () => {
  it("merges the HQ contact into the payload, posts to GHL_INTENT_URL_FOUNDER, stamps intentSentAt", async () => {
    const db = makeDb();
    await enqueueFounderIntent(db, src(), LIVE);
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    const out = await sendFounderIntentInline(db, { intentId: "i1", claimId: "C1", contactId: "HQC1", env: LIVE, send: { post }, fetchIdentity: async () => ({ firstName: "Ada", lastName: "Lovelace", email: "hq@x.test", phone: "+1888" }) });
    expect(out).toBe("sent");
    expect(post).toHaveBeenCalledWith("https://hook/founder", expect.objectContaining({ lastName: "Lovelace", email: "hq@x.test", phone: "+1888", hqContactId: "HQC1" }));
    expect(db.rows[0].status).toBe("sent");
    expect(db.claims[0].intentSentAt).toBeInstanceOf(Date);
  });
  it("HQ fetch failure still sends with DB values", async () => {
    const db = makeDb();
    await enqueueFounderIntent(db, src(), LIVE);
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await sendFounderIntentInline(db, { intentId: "i1", claimId: "C1", contactId: "HQC1", env: LIVE, send: { post }, fetchIdentity: async () => null })).toBe("sent");
    expect(post).toHaveBeenCalledWith("https://hook/founder", expect.objectContaining({ email: "a@x.test", firstName: "Ada" }));
  });
  it("a failed send never throws, leaves intentSentAt null and the row retryable", async () => {
    const db = makeDb();
    await enqueueFounderIntent(db, src(), LIVE);
    const out = await sendFounderIntentInline(db, { intentId: "i1", claimId: "C1", contactId: "HQC1", env: LIVE, send: { post: async () => ({ ok: false, status: 500 }) }, fetchIdentity: async () => null });
    expect(out).toBe("failed");
    expect(db.rows[0].status).toBe("failed");
    expect(db.claims[0].intentSentAt).toBeNull();
  });
});

describe("sendPendingIntents retry filter", () => {
  it("DUNNING_MODE=shadow + FOUNDER_INTENTS=live retries a failed founder row", async () => {
    const db = makeDb();
    await enqueueFounderIntent(db, src(), LIVE);
    db.rows[0].status = "failed";
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await sendPendingIntents(db, { delayMs: 0, deps: { post, env: { ...LIVE, DUNNING_MODE: "shadow" } } })).toEqual({ sent: 1, failed: 0 });
  });
  it("FOUNDER_INTENTS not live: a pending founder row is not picked up", async () => {
    const db = makeDb();
    await enqueueFounderIntent(db, src(), LIVE);
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await sendPendingIntents(db, { delayMs: 0, deps: { post, env: { GHL_INTENT_URL_FOUNDER: "https://hook/founder", DUNNING_MODE: "shadow" } } })).toEqual({ sent: 0, failed: 0 });
    expect(post).not.toHaveBeenCalled();
  });
});
