"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getBillingDb } from "@/lib/billing/db";
import { clientIp } from "@/lib/admin/audit";
import { adminBase, establishAdminSession } from "@/lib/admin/cookie";
import { attemptFallbackLogin } from "@/lib/admin/login";

export type LoginState = { error?: string };

export async function fallbackLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const code = String(formData.get("code") || "");
  const result = await attemptFallbackLogin(await getBillingDb(), code, { ip: clientIp(await headers()) });
  if (!result.ok) return { error: "Sign-in failed." }; // one generic message for every failure
  await establishAdminSession(result.session);
  redirect(`${await adminBase()}/`);
}
