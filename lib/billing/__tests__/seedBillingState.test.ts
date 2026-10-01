import { describe, expect, it } from "vitest";
import { BillingState, PauseReason } from "@prisma/client";
import { classifyLegacySubscription, trailingActivityWindowStart } from "../seedBillingState";
import { denverDayOf } from "../reports/denver";

describe("trailingActivityWindowStart", () => {
  it("is ~30 days before now, snapped to a Denver-day boundary", () => {
    const now = new Date("2026-09-27T15:00:00Z");
    const start = trailingActivityWindowStart(now);
    expect(denverDayOf(start)).toBe(denverDayOf(new Date(now.getTime() - 30 * 86_400_000)));
    // A Denver-day start is local midnight, so re-flooring it is a no-op.
    expect(denverDayOf(start) === denverDayOf(new Date(start.getTime() + 1000))).toBe(true);
  });

  it("respects a custom day count", () => {
    const now = new Date("2026-09-27T15:00:00Z");
    expect(trailingActivityWindowStart(now, 7).getTime()).toBeGreaterThan(trailingActivityWindowStart(now, 30).getTime());
  });
});

describe("classifyLegacySubscription", () => {
  it("null (unknown) → null: caller falls back or lists it, never guesses", () => {
    expect(classifyLegacySubscription(null)).toBeNull();
  });

  it("true (recent activity) → paused/non_payment, legacyUnreconciled", () => {
    expect(classifyLegacySubscription(true)).toMatchObject({ billingState: BillingState.paused, pauseReason: PauseReason.non_payment, legacyUnreconciled: true });
  });

  it("false (no recent activity) → churned, no pause reason, legacyUnreconciled", () => {
    expect(classifyLegacySubscription(false)).toMatchObject({ billingState: BillingState.churned, pauseReason: null, legacyUnreconciled: true });
  });
});
