import { describe, expect, it } from "vitest";
import { denverDateToInstant, diffExemption, exemptionUpdate, parseExemptionOptions } from "../exemption";

const LOC = "AbCdEfGhIjKlMnOpQrSt";
const parse = (o: Record<string, string>, flags: string[] = []) => parseExemptionOptions((k) => o[k], (n) => flags.includes(n));

describe("denverDateToInstant", () => {
  it("is Denver local midnight of that date (DST-aware)", () => {
    expect(denverDateToInstant("2026-11-21")?.toISOString()).toBe("2026-11-21T07:00:00.000Z");
    expect(denverDateToInstant("2026-09-21")?.toISOString()).toBe("2026-09-21T06:00:00.000Z");
    expect(denverDateToInstant("2026-11-01")?.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(denverDateToInstant("2026-03-08")?.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });
  it("rejects malformed and impossible dates", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-2-3", "11/21/2026", "", "2026-11-21T00:00"]) expect(denverDateToInstant(bad)).toBeNull();
  });
});

describe("parseExemptionOptions", () => {
  it("parses --until and --reason", () => {
    const r = parse({ "location-id": LOC, until: "2027-01-01", reason: " Founding partner " });
    expect(r.ok).toBe(true);
    if (!r.ok || r.plan.clear) throw new Error();
    expect(r.plan.until.toISOString()).toBe("2027-01-01T07:00:00.000Z");
    expect(r.plan.reason).toBe("Founding partner");
    expect(r.warnings).toEqual([]);
  });
  it("requires a real location id, a date and a reason", () => {
    expect(parse({ until: "2027-01-01", reason: "x" }).ok).toBe(false);
    expect(parse({ "location-id": "short", until: "2027-01-01", reason: "x" }).ok).toBe(false);
    expect(parse({ "location-id": LOC }).ok).toBe(false);
    expect(parse({ "location-id": LOC, until: "2027-01-01" }).ok).toBe(false);
    expect(parse({ "location-id": LOC, until: "2027-02-30", reason: "x" }).ok).toBe(false);
    expect(parse({ "location-id": LOC, until: "2027-01-01", reason: "x".repeat(501) }).ok).toBe(false);
  });
  it("--clear stands alone and clears both fields", () => {
    const r = parse({ "location-id": LOC }, ["clear"]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(exemptionUpdate(r.plan)).toEqual({ exemptUntil: null, exemptReason: null });
    expect(parse({ "location-id": LOC, until: "2027-01-01" }, ["clear"]).ok).toBe(false);
  });
  it("warns on a past date", () => {
    const r = parse({ "location-id": LOC, until: "2020-01-01", reason: "x" });
    expect(r.ok && r.warnings[0]).toMatch(/in the past/);
  });
});

describe("before/after", () => {
  it("lists exactly the changed fields", () => {
    const before = { exemptUntil: null, exemptReason: null };
    const r = parse({ "location-id": LOC, until: "2027-01-01", reason: "VIP" });
    if (!r.ok) throw new Error();
    expect(diffExemption(before, exemptionUpdate(r.plan)).filter((d) => d.changed).map((d) => d.field)).toEqual(["exemptUntil", "exemptReason"]);
    const same = exemptionUpdate(r.plan);
    expect(diffExemption(same, same).some((d) => d.changed)).toBe(false);
  });
});
