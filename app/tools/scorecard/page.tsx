import { redirect } from "next/navigation";
import { LogoFull } from "@/components/shared/Logo";
import Scorecard from "@/components/scorecard/Scorecard";
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
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8"><LogoFull size={32} /></div>
        <h1 className="text-2xl font-semibold">Campaign Scorecard</h1>
        <p className="mb-8 mt-1 text-sm text-gray">How your SMS campaigns are performing.</p>
        <Scorecard data={data} />
      </div>
    </main>
  );
}
