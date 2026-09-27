"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getBillingDb } from "@/lib/billing/db";
import { logAdmin, clientIp } from "@/lib/admin/audit";
import { adminBase, clearAdminSession } from "@/lib/admin/cookie";

export async function logoutAction(): Promise<void> {
  await logAdmin(await getBillingDb(), "logout", null, clientIp(await headers()));
  await clearAdminSession();
  redirect(`${await adminBase()}/login`);
}
