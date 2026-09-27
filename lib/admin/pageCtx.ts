import { adminBase } from "./cookie";
import { requireOwnerOrRedirect } from "./requireOwner";
import { getBillingDb } from "@/lib/billing/db";

/** Every money page starts here: owner check (redirects to login), billing DB (getBillingDb), link base, HQ location id. */
export async function pageCtx() {
  await requireOwnerOrRedirect();
  return { db: await getBillingDb(), base: await adminBase(), hq: process.env.GHL_HQ_LOCATION_ID ?? null, now: new Date() };
}
