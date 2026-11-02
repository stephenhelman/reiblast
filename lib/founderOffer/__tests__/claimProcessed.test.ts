import { describe, expect, it, vi } from "vitest";
import { claimProcessed } from "../claimProcessed";
import { findHandler } from "@/lib/promo/handlers";

type Row = Record<string, any>;
function run(body: Record<string, unknown>, claims: Row[], dryRun = false) {
  const store: Row[] = claims.map((c) => ({ studioContactId: null, ...c }));
  const claimDb: any = {
    store,
    founderClaim: {
      findUnique: async ({ where }: Row) => { const c = store.find((x) => x.token === where.token); return c ? { ...c, ghlAccount: { contactId: c.contactId } } : null; },
      updateMany: async ({ where, data }: Row) => { const c = store.find((x) => x.id === where.id && x.studioContactId === where.studioContactId); if (c) Object.assign(c, data); return { count: c ? 1 : 0 }; },
    },
  };
  return claimProcessed({ now: new Date(), dryRun, db: {} as never, body, claimDb }).then((out) => ({ out, store }));
}
const first = { id: "FC1", token: "tok1", contactId: "HQ1", isFirst: true };
const good = { promo: "founders-2026", event: "claim_processed", claimToken: "tok1", hqContactId: "HQ1", studioContactId: "ST1" };

describe("claim_processed (free winner only)", () => {
  it("is registered in the promo registry", () => {
    expect(findHandler("founders-2026", "claim_processed")).toBe(claimProcessed);
  });
  it("stores studioContactId on the free winner", async () => {
    const { out, store } = await run(good, [first]);
    expect(out).toEqual({ reason: "processed" });
    expect(store[0].studioContactId).toBe("ST1");
  });
  it("is idempotent: same studio id again → already_processed; a different one → studio_conflict, no overwrite", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(good, [{ ...first, studioContactId: "ST1" }])).out).toEqual({ reason: "already_processed" });
    const r = await run({ ...good, studioContactId: "ST2" }, [{ ...first, studioContactId: "ST1" }]);
    expect(r.out).toEqual({ reason: "studio_conflict" });
    expect(r.store[0].studioContactId).toBe("ST1");
  });
  it("hqContactId must match the claim's account: contact_mismatch, no write", async () => {
    const { out, store } = await run({ ...good, hqContactId: "OTHER" }, [first]);
    expect(out).toEqual({ reason: "contact_mismatch" });
    expect(store[0].studioContactId).toBeNull();
  });
  it("rejects any value containing '{{' and treats empty as null", async () => {
    for (const k of ["claimToken", "hqContactId", "studioContactId"]) {
      const { out, store } = await run({ ...good, [k]: "{{contact.id}}" }, [first]);
      expect(out).toEqual({ reason: "unrendered_tag" });
      expect(store[0].studioContactId).toBeNull();
    }
    expect((await run({ ...good, studioContactId: "" }, [first])).out).toEqual({ reason: "missing_studio_contact" });
    expect((await run({ ...good, claimToken: "" }, [first])).out).toEqual({ reason: "bad_request" });
  });
  it("unknown token, a non-first claim, and dryRun write nothing", async () => {
    expect((await run({ ...good, claimToken: "nope" }, [first])).out).toEqual({ reason: "claim_not_found" });
    const nf = await run(good, [{ ...first, isFirst: false }]);
    expect(nf.out).toEqual({ reason: "not_free_winner" });
    expect(nf.store[0].studioContactId).toBeNull();
    const dry = await run(good, [first], true);
    expect(dry.out).toEqual({ reason: "dry_run" });
    expect(dry.store[0].studioContactId).toBeNull();
  });
});
