import { describe, expect, it } from "vitest";
import { claimWindow, formatOpenTimeCt } from "../window";

const env = { FOUNDER_CLAIMS_OPEN_AT: "2026-10-29T00:00:00Z", FOUNDER_CLAIMS_CLOSE_AT: "2026-11-01T04:59:59Z" };

describe("claimWindow boundaries", () => {
  it("one ms before open is before; at open is open", () => {
    expect(claimWindow(new Date("2026-10-28T23:59:59.999Z"), env)).toBe("before");
    expect(claimWindow(new Date("2026-10-29T00:00:00.000Z"), env)).toBe("open");
  });
  it("one ms before close is open; at close is closed", () => {
    expect(claimWindow(new Date("2026-11-01T04:59:58.999Z"), env)).toBe("open");
    expect(claimWindow(new Date("2026-11-01T04:59:59.000Z"), env)).toBe("closed");
  });
  it("missing or invalid env fails closed", () => {
    expect(claimWindow(new Date(), {})).toBe("unavailable");
    expect(claimWindow(new Date(), { ...env, FOUNDER_CLAIMS_CLOSE_AT: "nope" })).toBe("unavailable");
  });
});

describe("formatOpenTimeCt", () => {
  it("renders the launch time in America/Chicago", () => {
    expect(formatOpenTimeCt(new Date("2026-10-29T00:00:00Z"))).toBe("Wednesday, Oct 28 at 7 PM CT");
  });
});
