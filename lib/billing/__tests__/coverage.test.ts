import { describe, expect, it } from "vitest";
import { applyPlan, coverageUpdate, denverDateToInstant, diffSnapshots, parseCoverageOptions, type CoverageSnapshot } from "../coverage";

const LOC = "AbCdEfGhIjKlMnOpQrSt";
const opts = (o: Record<string, string>) => parseCoverageOptions((k) => o[k]);

describe("denverDateToInstant", () => {
  it("is Denver local midnight of that date (DST-aware)", () => {
    expect(denverDateToInstant("2026-11-21")?.toISOString()).toBe("2026-11-21T07:00:00.000Z"); // MST (UTC−7)
    expect(denverDateToInstant("2026-09-21")?.toISOString()).toBe("2026-09-21T06:00:00.000Z"); // MDT (UTC−6)
    expect(denverDateToInstant("2026-11-01")?.toISOString()).toBe("2026-11-01T06:00:00.000Z"); // DST ends 02:00 that day; midnight still MDT
    expect(denverDateToInstant("2026-03-08")?.toISOString()).toBe("2026-03-08T07:00:00.000Z"); // DST starts 02:00 that day; midnight still MST
  });
  it("rejects malformed and impossible dates", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-2-3", "11/21/2026", "", "2026-11-21T00:00", "abcd-ef-gh"]) expect(denverDateToInstant(bad)).toBeNull();
    expect(denverDateToInstant("2028-02-29")).not.toBeNull(); // leap day
  });
});

describe("parseCoverageOptions", () => {
  const full = { "location-id": LOC, until: "2026-11-21", note: "Prepaid during processor migration (Aug double charge)", state: "active", "pause-reason": "none", "legacy-unreconciled": "false" };
  it("parses the whole plan", () => {
    const r = opts(full);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({ locationId: LOC, note: "Prepaid during processor migration (Aug double charge)", state: "active", pauseReason: null, legacyUnreconciled: false });
    expect(r.plan.until?.toISOString()).toBe("2026-11-21T07:00:00.000Z");
    expect(r.warnings).toEqual([]);
  });
  it("requires a real location id and at least one change", () => {
    expect(opts({ until: "2026-11-21" })).toEqual({ ok: false, error: "--location-id=<full GHL location id> is required" });
    expect(opts({ "location-id": "short", until: "2026-11-21" }).ok).toBe(false);
    expect(opts({ "location-id": LOC }).ok).toBe(false);
  });
  it("validates every option", () => {
    expect(opts({ "location-id": LOC, until: "2026-02-30" }).ok).toBe(false);
    expect(opts({ "location-id": LOC, state: "bogus" }).ok).toBe(false);
    expect(opts({ "location-id": LOC, "pause-reason": "bogus" }).ok).toBe(false);
    expect(opts({ "location-id": LOC, "legacy-unreconciled": "maybe" }).ok).toBe(false);
    expect(opts({ "location-id": LOC, note: "x".repeat(501) }).ok).toBe(false);
  });
  it("only what is asked for is in the update", () => {
    const r = opts({ "location-id": LOC, until: "2026-11-21" });
    if (!r.ok) throw new Error();
    expect(Object.keys(coverageUpdate(r.plan))).toEqual(["coreCoveredUntil"]);
    const r2 = opts({ "location-id": LOC, "pause-reason": "none" });
    if (!r2.ok) throw new Error();
    expect(coverageUpdate(r2.plan)).toEqual({ pauseReason: null }); // explicit null clears it
  });
  it("warns on a past date, a note with no date, and a pause reason on a non-paused state", () => {
    const past = opts({ "location-id": LOC, until: "2020-01-01" });
    expect(past.ok && past.warnings[0]).toMatch(/in the past/);
    const noDate = opts({ "location-id": LOC, note: "hi" });
    expect(noDate.ok && noDate.warnings[0]).toMatch(/without --until/);
    const odd = opts({ "location-id": LOC, state: "active", "pause-reason": "non_payment" });
    expect(odd.ok && odd.warnings[0]).toMatch(/non-paused/);
  });
});

describe("before/after", () => {
  const before: CoverageSnapshot = { billingState: "paused", pauseReason: "non_payment", legacyUnreconciled: true, coreCoveredUntil: null, coreCoverageNote: null };
  it("applies a plan and lists exactly the changed fields", () => {
    const r = opts({ "location-id": LOC, until: "2026-11-21", note: "n", state: "active", "pause-reason": "none", "legacy-unreconciled": "false" });
    if (!r.ok) throw new Error();
    const after = applyPlan(before, r.plan);
    expect(after).toEqual({ billingState: "active", pauseReason: null, legacyUnreconciled: false, coreCoveredUntil: new Date("2026-11-21T07:00:00.000Z"), coreCoverageNote: "n" });
    const d = diffSnapshots(before, after);
    expect(d.filter((x) => x.changed).map((x) => x.field)).toEqual(["billingState", "pauseReason", "legacyUnreconciled", "coreCoveredUntil", "coreCoverageNote"]);
    expect(d.find((x) => x.field === "pauseReason")).toMatchObject({ before: "non_payment", after: "(none)" });
  });
  it("untouched fields stay unchanged", () => {
    const r = opts({ "location-id": LOC, note: "just a note" });
    if (!r.ok) throw new Error();
    expect(diffSnapshots(before, applyPlan(before, r.plan)).filter((x) => x.changed).map((x) => x.field)).toEqual(["coreCoverageNote"]);
  });
});
