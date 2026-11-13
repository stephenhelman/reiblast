import Link from "next/link";
import Scorecard from "@/components/scorecard/Scorecard";
import ScorecardShell from "@/components/scorecard/ScorecardShell";
import { GHL_ID_RE } from "@/lib/campaign/stats";
import { prisma } from "@/lib/prisma";
import { isActiveMemberLocation } from "@/lib/scorecard/access";
import { loadScorecard } from "@/lib/scorecard/data";
import { verifyScorecardToken } from "@/lib/scorecard/token";

// Signed-link view (/scorecard/view?t=…). Outside the tools-session gate (middleware exempts this EXACT path): the token is the auth.
// middleware.ts also sets Referrer-Policy: no-referrer + no-store on this route; the metadata below repeats the referrer policy.
export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign Scorecard — REIblast", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border-default bg-surface p-8 text-center">
        <h1 className="mb-2 text-xl font-bold text-white">{title}</h1>
        <div className="text-sm leading-relaxed text-white/50">{children}</div>
      </div>
    </main>
  );
}

const linkClass = "mt-6 inline-flex items-center justify-center rounded-lg bg-gold px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-gold-hover";

export default async function ScorecardViewPage({ searchParams }: { searchParams: { t?: string | string[] } }) {
  const raw = Array.isArray(searchParams.t) ? searchParams.t[0] : searchParams.t;
  const result = raw ? await verifyScorecardToken(raw) : ({ ok: false, reason: "invalid" } as const);

  if (!result.ok) {
    // Expired (signature still verified): offer the OTP path straight to the scorecard. locationId only shapes the link — the OTP is the proof.
    if (result.reason === "expired" && GHL_ID_RE.test(result.locationId)) {
      return (
        <Notice title="This link has expired">
          <p>Scorecard links last 14 days. Verify with a quick code to open your scorecard now.</p>
          <Link href={`/enter?locationId=${encodeURIComponent(result.locationId)}&next=/scorecard`} className={linkClass}>
            Open my scorecard
          </Link>
        </Notice>
      );
    }
    return (
      <Notice title="This link isn&apos;t valid">
        <p>Open the Campaign Scorecard from your REIblast menu, or use the link in your latest scorecard email.</p>
      </Notice>
    );
  }

  // The token alone isn't enough: a member who is no longer active loses access immediately, not at token expiry.
  if (!(await isActiveMemberLocation(prisma, result.locationId))) {
    return (
      <Notice title="Scorecard not available">
        <p>We couldn&apos;t find an active account for this link. Contact support if this looks wrong.</p>
      </Notice>
    );
  }

  const data = await loadScorecard(prisma, result.locationId);
  return (
    <ScorecardShell>
      <Scorecard data={data} />
    </ScorecardShell>
  );
}
