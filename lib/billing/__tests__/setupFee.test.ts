import { describe, expect, it, vi } from "vitest";
import { applySignupFee, isSetupFeeCleared, markSetupFeePaid, parseSignupFee } from "../setupFee";
import { runSetupFeeBackfill } from "../setupFeeBackfill";

type Row = { id: string; userId: string; contactId: string; accountType: "member" | "internal"; setupFeeStatus: string | null; signupOffer: string | null };

/** In-memory GhlAccount covering exactly the where-shapes setupFee.ts / setupFeeBackfill.ts use. */
function fakeDb(rows: Row[]) {
  const match = (r: Row, w: any): boolean =>
    Object.entries(w ?? {}).every(([k, v]: [string, any]) => {
      if (k === "OR") return v.some((x: any) => match(r, x));
      const val = (r as any)[k];
      if (v === null) return val === null;
      if (v && typeof v === "object") {
        if ("in" in v) return v.in.includes(val);
        if ("not" in v) return val !== v.not;
      }
      return val === v;
    });
  return {
    rows,
    ghlAccount: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      count: vi.fn(async ({ where }: any) => rows.filter((r) => match(r, where)).length),
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => match(r, where))),
    },
  } as any;
}
const row = (o: Partial<Row> = {}): Row => ({ id: "A1", userId: "U1", contactId: "CONTACT0001", accountType: "member", setupFeeStatus: null, signupOffer: null, ...o });
const quiet = () => {};
const body = (customData: Record<string, unknown>) => ({ email: "a@b.test", customData });

describe("parseSignupFee", () => {
  it("maps true/false (trim + case-insensitive) to PENDING / NOT_REQUIRED", () => {
    expect(parseSignupFee(body({ setupFeeRequired: "true" }), quiet).setupFeeStatus).toBe("PENDING");
    expect(parseSignupFee(body({ setupFeeRequired: " FALSE " }), quiet).setupFeeStatus).toBe("NOT_REQUIRED");
  });
  it("anything else is null with a fixed marker that carries no value", () => {
    for (const v of ["yes", "1", "", "truee", true, 1, null]) {
      const log = vi.fn();
      expect(parseSignupFee(body({ setupFeeRequired: v }), log).setupFeeStatus).toBeNull();
      for (const c of log.mock.calls) expect(c[0]).not.toContain(String(v) || "\u0000");
    }
    const log = vi.fn();
    parseSignupFee(body({ setupFeeRequired: "maybe" }), log);
    expect(log).toHaveBeenCalledWith("[setup-fee] setupFeeRequired invalid_value");
  });
  it("absent fields parse to nulls without logging", () => {
    const log = vi.fn();
    expect(parseSignupFee({ email: "a@b.test" }, log)).toEqual({ setupFeeStatus: null, signupOffer: null });
    expect(log).not.toHaveBeenCalled();
  });
  it("rejects unrendered merge tags in both fields", () => {
    const log = vi.fn();
    expect(parseSignupFee(body({ setupFeeRequired: "{{custom.x}}", offer: "{{custom.offer}}" }), log)).toEqual({ setupFeeStatus: null, signupOffer: null });
    expect(log).toHaveBeenCalledTimes(2);
  });
  it("accepts the four known offers silently", () => {
    for (const o of ["standard-7", "founder-14", "ari-14", "ari-30"]) {
      const log = vi.fn();
      expect(parseSignupFee(body({ offer: o }), log).signupOffer).toBe(o);
      expect(log).not.toHaveBeenCalled();
    }
  });
  it("stores an unrecognized offer raw (trimmed) and logs it; drops an oversized one", () => {
    const log = vi.fn();
    expect(parseSignupFee(body({ offer: " Spring-21 " }), log).signupOffer).toBe("Spring-21");
    expect(log).toHaveBeenCalledWith('[setup-fee] offer unrecognized value="Spring-21"');
    expect(parseSignupFee(body({ offer: "x".repeat(65) }), quiet).signupOffer).toBeNull();
  });
  it("falls back to a flat top-level field (curl testing), like the other event routes", () => {
    expect(parseSignupFee({ setupFeeRequired: "true", offer: "ari-30" }, quiet)).toEqual({ setupFeeStatus: "PENDING", signupOffer: "ari-30" });
  });
});

describe("isSetupFeeCleared", () => {
  it("is true only for NOT_REQUIRED and PAID; null reads as UNKNOWN", () => {
    expect(isSetupFeeCleared("NOT_REQUIRED")).toBe(true);
    expect(isSetupFeeCleared("PAID")).toBe(true);
    for (const s of ["PENDING", "UNKNOWN", null, undefined] as const) expect(isSetupFeeCleared(s)).toBe(false);
  });
});

describe("applySignupFee (precedence, repeat hits)", () => {
  const parsed = { setupFeeStatus: "PENDING", signupOffer: "founder-14" } as const;

  it("sets both on a fresh (null) account", async () => {
    const db = fakeDb([row()]);
    expect(await applySignupFee(db, "U1", parsed)).toEqual({ status: 1, offer: 1 });
    expect(db.rows[0]).toMatchObject({ setupFeeStatus: "PENDING", signupOffer: "founder-14" });
  });
  it("overwrites UNKNOWN but nothing else", async () => {
    const db = fakeDb([row({ setupFeeStatus: "UNKNOWN" })]);
    await applySignupFee(db, "U1", parsed);
    expect(db.rows[0].setupFeeStatus).toBe("PENDING");
  });
  it.each(["PAID", "NOT_REQUIRED", "PENDING"])("never overwrites an existing %s (a renewal hit with different customData)", async (existing) => {
    const db = fakeDb([row({ setupFeeStatus: existing, signupOffer: "standard-7" })]);
    expect(await applySignupFee(db, "U1", { setupFeeStatus: existing === "PENDING" ? "NOT_REQUIRED" : "PENDING", signupOffer: "ari-30" })).toEqual({ status: 0, offer: 0 });
    expect(db.rows[0]).toMatchObject({ setupFeeStatus: existing, signupOffer: "standard-7" });
  });
  it("repeat identical hit is a no-op", async () => {
    const db = fakeDb([row()]);
    await applySignupFee(db, "U1", parsed);
    expect(await applySignupFee(db, "U1", parsed)).toEqual({ status: 0, offer: 0 });
  });
  it("a hit with no usable fields writes nothing; status stays null (= UNKNOWN)", async () => {
    const db = fakeDb([row()]);
    expect(await applySignupFee(db, "U1", { setupFeeStatus: null, signupOffer: null })).toEqual({ status: 0, offer: 0 });
    expect(db.ghlAccount.updateMany).not.toHaveBeenCalled();
    expect(db.rows[0].setupFeeStatus).toBeNull();
  });
  it("sets the offer even when status is already settled and offer is null", async () => {
    const db = fakeDb([row({ setupFeeStatus: "PAID" })]);
    expect(await applySignupFee(db, "U1", parsed)).toEqual({ status: 0, offer: 1 });
    expect(db.rows[0].setupFeeStatus).toBe("PAID");
  });
  it("never touches internal accounts or other users", async () => {
    const db = fakeDb([row({ accountType: "internal" }), row({ id: "A2", userId: "U2" })]);
    expect(await applySignupFee(db, "U1", parsed)).toEqual({ status: 0, offer: 0 });
    expect(await applySignupFee(db, "U9", parsed)).toEqual({ status: 0, offer: 0 });
  });
  it("propagates a db error (the route's own try/catch handles it)", async () => {
    const db = { ghlAccount: { updateMany: vi.fn().mockRejectedValue(new Error("boom")) } } as any;
    await expect(applySignupFee(db, "U1", parsed)).rejects.toThrow("boom");
  });
});

describe("markSetupFeePaid", () => {
  it.each([null, "UNKNOWN", "PENDING", "NOT_REQUIRED", "PAID"])("sets PAID from %s", async (from) => {
    const db = fakeDb([row({ setupFeeStatus: from })]);
    expect(await markSetupFeePaid(db, "A1")).toBe(true);
    expect(db.rows[0].setupFeeStatus).toBe("PAID");
  });
  it("is false for an unknown account", async () => {
    expect(await markSetupFeePaid(fakeDb([row()]), "NOPE")).toBe(false);
  });
});

describe("runSetupFeeBackfill", () => {
  const rows = () => [
    row({ id: "A1", contactId: "CONTACT0001" }),
    row({ id: "A2", userId: "U2", contactId: "CONTACT0002", setupFeeStatus: "PENDING" }),
    row({ id: "A3", userId: "U3", contactId: "CONTACT0003" }),
    row({ id: "A4", userId: "U4", contactId: "CONTACT0004", accountType: "internal" }),
  ];

  it("dry-run reports counts and writes nothing", async () => {
    const db = fakeDb(rows());
    const r = await runSetupFeeBackfill(db, { apply: false, paidContactIds: ["CONTACT0003", "CONTACT0099"] });
    expect(r.nullMembers).toBe(2);
    expect(r.notRequiredSet).toBe(0);
    expect(r.paid).toMatchObject({ requested: 2, matched: 1, missing: ["CONTACT0099"], alreadyPaid: 0, toSet: 1, applied: 0 });
    expect(db.ghlAccount.updateMany).not.toHaveBeenCalled();
    expect(db.rows.map((x: Row) => x.setupFeeStatus)).toEqual([null, "PENDING", null, null]);
  });
  it("apply: null members -> NOT_REQUIRED, listed member -> PAID, others (PENDING, internal) untouched", async () => {
    const db = fakeDb(rows());
    const r = await runSetupFeeBackfill(db, { apply: true, paidContactIds: ["CONTACT0003"] });
    expect(r.notRequiredSet).toBe(2);
    expect(r.paid.applied).toBe(1);
    expect(db.rows.map((x: Row) => x.setupFeeStatus)).toEqual(["NOT_REQUIRED", "PENDING", "PAID", null]);
  });
  it("PAID can also override a non-null status for a listed member", async () => {
    const db = fakeDb(rows());
    await runSetupFeeBackfill(db, { apply: true, paidContactIds: ["CONTACT0002"] });
    expect(db.rows[1].setupFeeStatus).toBe("PAID");
  });
  it("is idempotent", async () => {
    const db = fakeDb(rows());
    await runSetupFeeBackfill(db, { apply: true, paidContactIds: ["CONTACT0003"] });
    const again = await runSetupFeeBackfill(db, { apply: true, paidContactIds: ["CONTACT0003"] });
    expect(again).toMatchObject({ nullMembers: 0, notRequiredSet: 0, paid: { matched: 1, alreadyPaid: 1, toSet: 0, applied: 0 } });
  });
  it("de-duplicates contact ids and rejects malformed ones before writing", async () => {
    const db = fakeDb(rows());
    expect((await runSetupFeeBackfill(db, { apply: false, paidContactIds: ["CONTACT0003", "CONTACT0003"] })).paid.requested).toBe(1);
    await expect(runSetupFeeBackfill(db, { apply: true, paidContactIds: ["bad id!"] })).rejects.toThrow(/not a valid GHL contact id/);
    expect(db.ghlAccount.updateMany).not.toHaveBeenCalled();
  });
  it("with no --paid-contact only step 1 runs", async () => {
    const db = fakeDb(rows());
    const r = await runSetupFeeBackfill(db, { apply: true });
    expect(r.notRequiredSet).toBe(2);
    expect(r.paid).toMatchObject({ requested: 0, matched: 0, applied: 0 });
  });
});
