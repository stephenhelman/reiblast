import { describe, expect, it } from "vitest";
import { safeNext } from "../safeNext";

describe("safeNext", () => {
  it("allows exactly /scorecard", () => expect(safeNext("/scorecard")).toBe("/scorecard"));
  it.each(["/", "/scorecard/", "/scorecard?x=1", "/scorecard/view", "//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", " /scorecard", "/SCORECARD", "", "/analyzer"])(
    "rejects %j", (v) => expect(safeNext(v)).toBeNull());
  it("rejects non-strings", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(["/scorecard"])).toBeNull();
    expect(safeNext(new File([], "x") as unknown)).toBeNull();
  });
});
