import { SUPPORT_PHONE_DISPLAY } from "@/lib/constants";
import type { ClaimView } from "./claim";
import { ineligibleMessage, type IneligibleReason } from "./eligibility";
import type { ClaimWindow } from "./window";

export const PAGE_TITLE = "Founder's Offer: REIsite + REIkit";
export const FOOTER = "REIsite and REIkit are provided by OP Web Studio, a subsidiary of Operation Profit LLC.";
export const NO_LINK_MESSAGE = "Open your personal claim link from #founders-claim in the REIblast Discord.";
export const LINK_EXPIRED_MESSAGE = "This link expired. Press Claim my spot in #founders-claim again.";
export const SOLD_OUT_MESSAGE = "All 10 founder slots are claimed.";
export const CLOSED_MESSAGE = "Founder claims are closed.";
export const UNAVAILABLE_MESSAGE = "Founder claims aren't available right now.";

export const slotsLine = (left: number) => `${left} of 10 founder slots left`;
export const opensLine = (openTimeCt: string) => `Founder claims open ${openTimeCt}`;

/** What a held claim says, by status (same wording for a fresh claim and a revisit). */
export function claimStatusMessage(c: Pick<ClaimView, "status" | "isFirst">): string {
  if (c.status === "FREE_WINNER") return "You're our first founder! Your REIsite and REIkit are free. Check your texts for next steps.";
  if (c.status === "PAID") return "Your founder slot is paid and locked in. REIsite and REIkit are yours. Check your texts for next steps.";
  return "Your slot is reserved. Your $100 invoice is on its way by text and email. Pay within 24 hours to lock it in. REIkit is included free.";
}

export function windowMessage(w: Exclude<ClaimWindow, "open">, openTimeCt: string | null): string {
  if (w === "before") return openTimeCt ? opensLine(openTimeCt) : UNAVAILABLE_MESSAGE;
  return w === "closed" ? CLOSED_MESSAGE : UNAVAILABLE_MESSAGE;
}

const SUPPORT = `text us at ${SUPPORT_PHONE_DISPLAY}`;
export function startRefusalMessage(reason: "not_open" | "link_invalid" | "rate_limited" | "delivery_failed"): string {
  switch (reason) {
    case "not_open": return "Founder claims aren't open right now.";
    case "link_invalid": return LINK_EXPIRED_MESSAGE;
    case "rate_limited": return "Too many tries. Please wait a few minutes and try again.";
    case "delivery_failed": return `We couldn't text your code, ${SUPPORT}.`;
  }
}

export function confirmRefusalMessage(reason: "not_open" | "link_invalid" | "rate_limited" | "code_expired" | "code_locked" | "invalid_code", attemptsRemaining?: number): string {
  switch (reason) {
    case "invalid_code": return attemptsRemaining != null ? `That code isn't right. ${attemptsRemaining} ${attemptsRemaining === 1 ? "try" : "tries"} left.` : "That code isn't right. Send a new code and try again.";
    case "code_expired": return "That code expired. Send a new code.";
    case "code_locked": return "Too many wrong tries. Send a new code.";
    case "rate_limited": return "Too many tries. Please wait a few minutes and try again.";
    case "link_invalid": return LINK_EXPIRED_MESSAGE;
    case "not_open": return "Founder claims aren't open right now.";
  }
}

export type ClaimUi =
  | { kind: "claim"; status: ClaimView["status"]; isFirst: boolean }
  | { kind: "sold_out" }
  | { kind: "message"; message: string };

export function ineligibleUi(reason: IneligibleReason): ClaimUi {
  return { kind: "message", message: ineligibleMessage(reason) };
}
