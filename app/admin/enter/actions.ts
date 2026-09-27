"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getBillingDb } from "@/lib/billing/db";
import { clientIp } from "@/lib/admin/audit";
import { adminBase, establishAdminSession } from "@/lib/admin/cookie";
import { attemptSmsLogin, startEntry } from "@/lib/admin/login";

export type VerifyState = { error?: string };
export type ResendState = { message?: string; error?: string };

export async function verifyEntryAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const locationId = String(formData.get("locationId") || "");
  const code = String(formData.get("code") || "");
  const result = await attemptSmsLogin(await getBillingDb(), locationId || null, code, { ip: clientIp(await headers()) });
  if (!result.ok) return { error: "That code didn’t work. Request a new one." }; // one generic message for every failure
  await establishAdminSession(result.session);
  redirect(`${await adminBase()}/`);
}

export async function resendEntryAction(_prev: ResendState, formData: FormData): Promise<ResendState> {
  const locationId = String(formData.get("locationId") || "");
  const r = await startEntry(await getBillingDb(), locationId || null, { ip: clientIp(await headers()), force: true });
  if (r.status === "sent") return { message: "A new code has been sent." };
  if (r.status === "rate_limited") return { error: "Too many codes requested. Wait a few minutes and try again." };
  return { error: "Couldn’t send a code. Try again shortly." };
}
