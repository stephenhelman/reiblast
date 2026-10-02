import { describe, expect, it } from "vitest";
import { accountLabel, formatAccountLabel } from "../accountLabel";

const HQ = "LOCATION_HQ_xBkY";

describe("accountLabel fallback order", () => {
  it("locationName wins", () => {
    expect(accountLabel({ locationId: "LOC_ab12", locationName: "Acme Wholesale", businessName: "Acme LLC" }, HQ)).toEqual({ name: "Acme Wholesale", suffix: "…ab12" });
  });
  it("then User.businessName", () => {
    expect(accountLabel({ locationId: "LOC_ab12", locationName: null, businessName: "Acme LLC" }, HQ)).toEqual({ name: "Acme LLC", suffix: "…ab12" });
  });
  it("then \"Unnamed location\"", () => {
    expect(accountLabel({ locationId: "LOC_ab12" }, HQ)).toEqual({ name: "Unnamed location", suffix: "…ab12" });
  });
  it("blank, whitespace and \"-\" names are skipped", () => {
    expect(accountLabel({ locationId: "LOC_ab12", locationName: "  ", businessName: "Acme LLC" }, HQ).name).toBe("Acme LLC");
    expect(accountLabel({ locationId: "LOC_ab12", locationName: "-", businessName: "-" }, HQ).name).toBe("Unnamed location");
  });
  it("trims names", () => expect(accountLabel({ locationId: "LOC_ab12", locationName: "  Acme  " }, HQ).name).toBe("Acme"));

  it("HQ is always \"REIblast HQ\", even if it has a name, and keeps its suffix", () => {
    expect(accountLabel({ locationId: HQ, locationName: "Something Else" }, HQ)).toEqual({ name: "REIblast HQ", suffix: "…xBkY" });
    expect(accountLabel({ scopeKey: HQ }, HQ).name).toBe("REIblast HQ");
  });
  it("wallet scopes get fixed labels and no suffix", () => {
    expect(accountLabel({ scopeKey: "_agency", locationName: "ignored" }, HQ)).toEqual({ name: "Agency (GHL wallet)", suffix: null });
    expect(accountLabel({ scopeKey: "_unattributed" }, HQ)).toEqual({ name: "Unattributed", suffix: null });
    expect(accountLabel({ locationId: "_agency" }, HQ).name).toBe("Agency (GHL wallet)");
  });
  it("without an HQ id configured, nothing is mistaken for HQ", () => {
    expect(accountLabel({ locationId: "LOC_ab12", locationName: "Acme" }, undefined).name).toBe("Acme");
    expect(accountLabel({ locationId: HQ }, null).name).toBe("Unnamed location");
  });
  it("no id at all → name with no suffix; formatAccountLabel joins them", () => {
    expect(accountLabel({ businessName: "Acme LLC" }, HQ)).toEqual({ name: "Acme LLC", suffix: null });
    expect(formatAccountLabel({ name: "Acme", suffix: "…ab12" })).toBe("Acme …ab12");
    expect(formatAccountLabel({ name: "Unattributed", suffix: null })).toBe("Unattributed");
  });
});
