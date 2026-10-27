import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFounderCheckoutLink, isFounderOfferOpen } from "@/lib/founderOffer";

const KEYS = ["FOUNDER_OFFER_ENABLED", "FOUNDER_OFFER_ENDS_AT", "FOUNDER_CHECKOUT_LINK"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ENDS = "2026-11-01T04:59:59Z";

describe("isFounderOfferOpen", () => {
  it("is open when enabled and before the deadline", () => {
    process.env.FOUNDER_OFFER_ENABLED = "true";
    process.env.FOUNDER_OFFER_ENDS_AT = ENDS;
    expect(isFounderOfferOpen(new Date("2026-10-25T12:00:00Z"))).toBe(true);
    expect(isFounderOfferOpen(new Date("2026-11-01T04:59:58Z"))).toBe(true);
  });

  it("is closed at and after the deadline", () => {
    process.env.FOUNDER_OFFER_ENABLED = "true";
    process.env.FOUNDER_OFFER_ENDS_AT = ENDS;
    expect(isFounderOfferOpen(new Date(ENDS))).toBe(false);
    expect(isFounderOfferOpen(new Date("2026-11-02T00:00:00Z"))).toBe(false);
  });

  it("is closed when the flag is not exactly \"true\"", () => {
    process.env.FOUNDER_OFFER_ENDS_AT = ENDS;
    const before = new Date("2026-10-25T12:00:00Z");
    expect(isFounderOfferOpen(before)).toBe(false); // unset
    for (const v of ["false", "TRUE", "1", ""]) {
      process.env.FOUNDER_OFFER_ENABLED = v;
      expect(isFounderOfferOpen(before)).toBe(false);
    }
  });

  it("fails closed on a missing or invalid deadline", () => {
    process.env.FOUNDER_OFFER_ENABLED = "true";
    const now = new Date("2026-10-25T12:00:00Z");
    expect(isFounderOfferOpen(now)).toBe(false); // missing
    process.env.FOUNDER_OFFER_ENDS_AT = "not-a-date";
    expect(isFounderOfferOpen(now)).toBe(false);
  });
});

describe("getFounderCheckoutLink", () => {
  it("returns null when missing or blank", () => {
    expect(getFounderCheckoutLink()).toBeNull();
    process.env.FOUNDER_CHECKOUT_LINK = "   ";
    expect(getFounderCheckoutLink()).toBeNull();
  });

  it("returns the trimmed URL when set", () => {
    process.env.FOUNDER_CHECKOUT_LINK = " https://api.leadconnectorhq.com/widget/form/abc ";
    expect(getFounderCheckoutLink()).toBe("https://api.leadconnectorhq.com/widget/form/abc");
  });
});
