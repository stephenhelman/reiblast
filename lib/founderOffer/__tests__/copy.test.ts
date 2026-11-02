import { describe, expect, it } from "vitest";
import { claimStatusMessage, confirmRefusalMessage, slotsLine, startRefusalMessage, windowMessage } from "../copy";

describe("founder claim copy", () => {
  it("results match the spec wording", () => {
    expect(claimStatusMessage({ status: "FREE_WINNER", isFirst: true })).toBe("You're our first founder! Your REIsite and REIkit are free. Check your texts for next steps.");
    expect(claimStatusMessage({ status: "PENDING_PAYMENT", isFirst: false })).toBe("Your slot is reserved. Your $100 invoice is on its way by text and email. Pay within 24 hours to lock it in. REIkit is included free.");
    expect(slotsLine(7)).toBe("7 of 10 founder slots left");
  });
  it("window messages", () => {
    expect(windowMessage("before", "Wednesday, Oct 28 at 7 PM CT")).toBe("Founder claims open Wednesday, Oct 28 at 7 PM CT");
    expect(windowMessage("closed", null)).toBe("Founder claims are closed.");
  });
  it("refusals tell the member what to do", () => {
    expect(startRefusalMessage("link_invalid")).toContain("Press Claim my spot in #founders-claim again");
    expect(startRefusalMessage("delivery_failed")).toContain("(915) 800-8266");
    expect(confirmRefusalMessage("invalid_code", 1)).toContain("1 try left");
    expect(confirmRefusalMessage("invalid_code", 2)).toContain("2 tries left");
  });
});
