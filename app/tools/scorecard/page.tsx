import { redirect } from "next/navigation";
import Scorecard from "@/components/scorecard/Scorecard";
import ScorecardShell from "@/components/scorecard/ScorecardShell";
import { prisma } from "@/lib/prisma";
import { getMemberFromCookies } from "@/lib/requireMember";
import { loadScorecard } from "@/lib/scorecard/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign Scorecard — REIblast" };

export default async function ScorecardPage() {
  // locationId comes ONLY from the verified tools session (never the URL). middleware.ts already gates this route; this re-check also
  // confirms the member is still active and the session's location still matches their record.
  const member = await getMemberFromCookies();
  if (!member) redirect("/session-expired");

  const data = await loadScorecard(prisma, member.locationId);
  return (
    <ScorecardShell>
      <Scorecard data={data} />
    </ScorecardShell>
  );
}
