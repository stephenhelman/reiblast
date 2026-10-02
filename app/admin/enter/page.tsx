import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { GateScreen } from "@/components/admin/ui";
import { clientIp } from "@/lib/admin/audit";
import { ADMIN_COOKIE } from "@/lib/admin/config";
import { adminBase } from "@/lib/admin/cookie";
import { startEntry } from "@/lib/admin/login";
import { checkOwnerToken } from "@/lib/admin/ownerCheck";
import { getBillingDb } from "@/lib/billing/db";
import { EnterForm } from "./EnterForm";

export const dynamic = "force-dynamic";

/**
 * Opened from the custom menu link in the HQ sub-account: /enter?locationId=<id>  (admin host) or /admin/enter?locationId=<id>
 * (preview). Gate: locationId ∈ ADMIN_LOCATION_IDS → internal GhlAccount → active User. Every failure renders the SAME
 * generic screen (the reason goes only to AdminAuditLog).
 */
export default async function EnterPage({ searchParams }: { searchParams: { locationId?: string } }) {
  const locationId = searchParams.locationId || "";
  const db = await getBillingDb();

  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (token) {
    try {
      const owner = await checkOwnerToken(token, db);
      if (!locationId || owner.locationId === locationId) redirect(`${await adminBase()}/`);
    } catch (err) {
      if (err && typeof err === "object" && "digest" in err) throw err; // Next's redirect signal
    }
  }

  const r = await startEntry(db, locationId || null, { ip: clientIp(await headers()) });
  if (r.status === "denied") return <GateScreen title="Access not available" message="We couldn’t verify your access. Reopen this page from your CRM menu." />;
  if (r.status === "rate_limited") return <GateScreen title="Too many codes" message="A code was requested too many times. Wait a few minutes, then reload." />;
  if (r.status === "send_failed") return <GateScreen title="Couldn’t send code" message="We couldn’t send your verification code. Reload this page to try again." />;

  return (
    <GateScreen title="Enter your code">
      <p className="mb-6 text-sm text-white/50">{r.status === "cooldown" ? "A code was already sent" : "We sent a code"} to your phone inside the CRM. Enter it here.</p>
      <EnterForm locationId={locationId} />
    </GateScreen>
  );
}
