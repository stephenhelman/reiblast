import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chicagoRunKey, getPromoPhase } from "../phase";

const OPEN = "2026-10-29T00:00:00Z";
const CLOSE = "2026-11-01T04:59:59Z";
beforeEach(() => {
  process.env.FOUNDER_CLAIMS_OPEN_AT = OPEN;
  process.env.FOUNDER_CLAIMS_CLOSE_AT = CLOSE;
});
afterEach(() => {
  delete process.env.FOUNDER_CLAIMS_OPEN_AT;
  delete process.env.FOUNDER_CLAIMS_CLOSE_AT;
});

describe("getPromoPhase", () => {
  it("is pre one ms before open, open exactly at open", () => {
    expect(getPromoPhase(new Date("2026-10-28T23:59:59.999Z"))).toMatchObject({ ok: true, phase: "pre" });
    expect(getPromoPhase(new Date(OPEN))).toMatchObject({ ok: true, phase: "open" });
  });
  it("is open one ms before close, closed exactly at close", () => {
    expect(getPromoPhase(new Date("2026-11-01T04:59:58.999Z"))).toMatchObject({ ok: true, phase: "open" });
    expect(getPromoPhase(new Date(CLOSE))).toEqual({ ok: false, reason: "offer_closed" });
  });
  it("fails closed on missing, invalid, or inverted config", () => {
    delete process.env.FOUNDER_CLAIMS_OPEN_AT;
    expect(getPromoPhase()).toEqual({ ok: false, reason: "not_configured" });
    process.env.FOUNDER_CLAIMS_OPEN_AT = "nope";
    expect(getPromoPhase()).toEqual({ ok: false, reason: "not_configured" });
    process.env.FOUNDER_CLAIMS_OPEN_AT = CLOSE;
    process.env.FOUNDER_CLAIMS_CLOSE_AT = OPEN;
    expect(getPromoPhase()).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("chicagoRunKey", () => {
  it("uses the Central date and 24h hour (CDT, UTC-5)", () => {
    expect(chicagoRunKey(new Date("2026-10-25T21:30:00Z"))).toBe("2026-10-25T16");
  });
  it("rolls the date back across UTC midnight", () => {
    expect(chicagoRunKey(new Date("2026-10-26T03:59:00Z"))).toBe("2026-10-25T22");
    expect(chicagoRunKey(new Date("2026-10-26T05:00:00Z"))).toBe("2026-10-26T00");
  });
  it("switches offset after DST ends (CST, UTC-6)", () => {
    expect(chicagoRunKey(new Date("2026-11-01T07:00:00Z"))).toBe("2026-11-01T01");
  });
});
