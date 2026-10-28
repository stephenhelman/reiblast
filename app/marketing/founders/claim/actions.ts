"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { mintOtp, verifyOtp } from "@/lib/otp";
import { fetchContactPhoneLast4 } from "@/lib/discord/ghlContact";
import { claimFounderSlot } from "@/lib/founderOffer/claim";
import { LINK_EXPIRED_MESSAGE, confirmRefusalMessage, ineligibleUi, startRefusalMessage, windowMessage, type ClaimUi } from "@/lib/founderOffer/copy";
import { verifyFounderLink } from "@/lib/founderOffer/linkToken";
import { handleOtpConfirm, handleOtpStart, type FounderOtpDb } from "@/lib/founderOffer/otp";
import { FOUNDERS_COOKIE_OPTIONS, FOUNDERS_SESSION_COOKIE, signFoundersSession, verifyFoundersSession } from "@/lib/founderOffer/session";
import { claimsOpenAt, formatOpenTimeCt } from "@/lib/founderOffer/window";

// Server Actions on /founders/claim, covered by the /founders geo gate in middleware. Identity is the signed link token
// (minted by /api/discord/founder-link); the OTP proves the member controls the phone on file.

const db = () => prisma as unknown as FounderOtpDb;

export type StartResult = { ok: true; phoneLast4: string } | { ok: false; message: string };
export type ConfirmResult = { ok: true } | { ok: false; message: string };

export async function startCodeAction(token: string): Promise<StartResult> {
  try {
    const link = await verifyFounderLink(String(token));
    if (!link) return { ok: false, message: LINK_EXPIRED_MESSAGE };
    const r = await handleOtpStart({ db: db(), mintOtp, fetchPhoneLast4: fetchContactPhoneLast4 }, link);
    return r.result === "sent" ? { ok: true, phoneLast4: r.phoneLast4 } : { ok: false, message: startRefusalMessage(r.reason) };
  } catch {
    console.error("[founders/claim] startCodeAction failed");
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function confirmCodeAction(token: string, code: string): Promise<ConfirmResult> {
  try {
    const link = await verifyFounderLink(String(token));
    if (!link) return { ok: false, message: LINK_EXPIRED_MESSAGE };
    const clean = String(code).trim();
    if (!/^\d{6}$/.test(clean)) return { ok: false, message: "Enter the 6-digit code from your text." };
    const r = await handleOtpConfirm({ db: db(), verifyOtp }, { ...link, code: clean });
    if (r.result !== "verified") return { ok: false, message: confirmRefusalMessage(r.reason, "attemptsRemaining" in r ? r.attemptsRemaining : undefined) };
    cookies().set(FOUNDERS_SESSION_COOKIE, await signFoundersSession({ userId: r.userId, ghlAccountId: r.ghlAccountId }), FOUNDERS_COOKIE_OPTIONS);
    return { ok: true };
  } catch {
    console.error("[founders/claim] confirmCodeAction failed");
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function claimAction(token: string): Promise<ClaimUi> {
  const generic: ClaimUi = { kind: "message", message: "Something went wrong. Please try again, or press Claim my spot in #founders-claim again." };
  try {
    const link = await verifyFounderLink(String(token));
    if (!link) return { kind: "message", message: LINK_EXPIRED_MESSAGE };
    const raw = cookies().get(FOUNDERS_SESSION_COOKIE)?.value;
    const session = raw ? await verifyFoundersSession(raw) : null;
    if (!session || session.ghlAccountId !== link.ghlAccountId) return { kind: "message", message: "Please verify your code again." };

    const out = await claimFounderSlot(prisma, link.ghlAccountId);
    switch (out.result) {
      case "claimed":
      case "existing":
        return { kind: "claim", status: out.claim.status, isFirst: out.claim.isFirst };
      case "sold_out":
        return { kind: "sold_out" };
      case "not_open": {
        const open = claimsOpenAt();
        return { kind: "message", message: windowMessage(out.window, open ? formatOpenTimeCt(open) : null) };
      }
      case "ineligible":
        return ineligibleUi(out.reason);
    }
  } catch {
    console.error("[founders/claim] claimAction failed");
    return generic;
  }
}
