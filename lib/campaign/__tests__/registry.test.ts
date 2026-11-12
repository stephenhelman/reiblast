import { describe, expect, it } from "vitest";
import { CAMPAIGNS, VARIANTS, isKnownVariant, parseVariant, variantLabel } from "../registry";

describe("campaign registry", () => {
  it("has 10 campaigns and 30 unique variants", () => {
    expect(CAMPAIGNS).toHaveLength(10);
    expect(VARIANTS).toHaveLength(30);
    expect(new Set(VARIANTS.map((v) => v.value)).size).toBe(30);
  });
  it("labels", () => {
    expect(variantLabel("default-1")).toBe("Default 1");
    expect(variantLabel("probate-2")).toBe("Probate 2");
    expect(variantLabel("high-equity-3")).toBe("High Equity 3");
    expect(variantLabel("pre-foreclosure-1")).toBe("Pre-Foreclosure 1");
    expect(variantLabel("")).toBe("Unlabeled");
    expect(variantLabel("high-equty-3")).toBe("high-equty-3");
  });
  it("knows variants", () => {
    expect(isKnownVariant("tired-landlord-2")).toBe(true);
    expect(isKnownVariant("Probate-2")).toBe(false);
    expect(parseVariant("vacant-3")?.campaign).toBe("vacant");
  });
});
