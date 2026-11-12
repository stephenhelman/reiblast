import { describe, expect, it } from "vitest";
import { LIST_TYPES, buildBatchLeadsExportRows, type CleanedContact } from "../leadCleaner";

const contact = (n: number): CleanedContact => ({ firstName: `F${n}`, lastName: `L${n}`, propertyAddress: `${n} Main St`, city: "Denver", state: "CO", zip: "80202", phone: `303555000${n}`, phoneType: "Mobile", email: "" });

describe("BatchLeads CSV export: List Type + List Name columns", () => {
  it("the option strings are exactly the GHL dropdown values, in order", () => {
    expect([...LIST_TYPES]).toEqual(["Absentee Owner", "Tax Delinquent", "Pre-Foreclosure", "Probate", "Vacant", "Tired Landlord", "High Equity", "Expired Listing", "Code Violation", "None"]);
  });
  it("every row carries List Type and List Name (the exact file name), after the contact columns", () => {
    const rows = buildBatchLeadsExportRows([contact(1), contact(2), contact(3)], "Tax Delinquent", "Denver_Oct_List");
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r["List Type"]).toBe("Tax Delinquent");
      expect(r["List Name"]).toBe("Denver_Oct_List");
    }
    expect(Object.keys(rows[0])).toEqual(["First Name", "Last Name", "Property Address", "City", "State", "Zip", "Phone", "Email", "List Type", "List Name"]);
    expect(rows[1]).toMatchObject({ "First Name": "F2", Phone: "3035550002" });
  });
  it("None yields a blank List Type but still writes the List Name", () => {
    const rows = buildBatchLeadsExportRows([contact(1)], "None", "My List");
    expect(rows[0]["List Type"]).toBe("");
    expect(rows[0]["List Name"]).toBe("My List");
    expect(Object.keys(rows[0])).toContain("List Type");
  });
});
