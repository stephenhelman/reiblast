import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LogoFull } from "@/components/shared/Logo";
import { prisma } from "@/lib/prisma";
import { getClaimView } from "@/lib/founderOffer/claim";
import { CLOSED_MESSAGE, FOOTER, LINK_EXPIRED_MESSAGE, NO_LINK_MESSAGE, PAGE_TITLE, SOLD_OUT_MESSAGE, UNAVAILABLE_MESSAGE, claimStatusMessage, opensLine, slotsLine } from "@/lib/founderOffer/copy";
import { getFounderSlotsLeft } from "@/lib/founderOffer";
import { verifyFounderLink } from "@/lib/founderOffer/linkToken";
import { FOUNDERS_SESSION_COOKIE, verifyFoundersSession } from "@/lib/founderOffer/session";
import { claimWindow, claimsOpenAt, formatOpenTimeCt } from "@/lib/founderOffer/window";
import ClaimFlow from "./ClaimFlow";
import Countdown from "./Countdown";

// Evaluated per request: the window, the slot count and the member's own claim all change without a redeploy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founder's Offer — REIblast",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black px-5 pt-28 pb-12 flex flex-col">
      <div className="w-full max-w-md mx-auto flex-1">
        <div className="flex justify-center mb-8"><LogoFull size={26} /></div>
        {children}
      </div>
      <p className="text-gray text-xs text-center max-w-md mx-auto mt-12 leading-relaxed">{FOOTER}</p>
    </div>
  );
}

function Header({ slotsLeft }: { slotsLeft: number }) {
  return (
    <header className="text-center mb-8">
      <p className="text-gold text-xs font-bold uppercase tracking-widest mb-3">{PAGE_TITLE}</p>
      <p className="text-white text-2xl font-extrabold">{slotsLine(slotsLeft)}</p>
    </header>
  );
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-surface border border-gold/30 rounded-xl p-6 space-y-5">{children}</div>
);

export default async function FounderClaimPage({ searchParams }: { searchParams: { t?: string | string[] } }) {
  const window = claimWindow(new Date());
  const openAt = claimsOpenAt();
  const slotsLeft = await getFounderSlotsLeft();
  const rawToken = Array.isArray(searchParams.t) ? searchParams.t[0] : searchParams.t;
  const link = rawToken ? await verifyFounderLink(rawToken) : null;

  const Status = () =>
    window === "before" && openAt ? (
      <div className="text-center space-y-2">
        <p className="text-white font-semibold">{opensLine(formatOpenTimeCt(openAt))}</p>
        <Countdown openAtIso={openAt.toISOString()} />
      </div>
    ) : window === "closed" ? (
      <p className="text-white font-semibold text-center">{CLOSED_MESSAGE}</p>
    ) : window === "unavailable" || window === "before" ? (
      <p className="text-white font-semibold text-center">{UNAVAILABLE_MESSAGE}</p>
    ) : null;

  // No token: static page, no form.
  if (!rawToken) {
    return (
      <Shell>
        <Header slotsLeft={slotsLeft} />
        <Card>
          <Status />
          {window === "open" && <p className="text-white text-center">{NO_LINK_MESSAGE}</p>}
          {window === "before" && <p className="text-white/60 text-sm text-center">{NO_LINK_MESSAGE}</p>}
        </Card>
      </Shell>
    );
  }

  if (!link) {
    return (
      <Shell>
        <Header slotsLeft={slotsLeft} />
        <Card><p className="text-white text-center">{LINK_EXPIRED_MESSAGE}</p></Card>
      </Shell>
    );
  }

  const [account, existing] = await Promise.all([
    prisma.ghlAccount.findUnique({ where: { id: link.ghlAccountId }, select: { user: { select: { name: true } } } }),
    getClaimView(prisma, link.ghlAccountId),
  ]);
  const firstName = account?.user.name?.trim().split(/\s+/)[0] ?? null;
  const session = await (async () => {
    const raw = cookies().get(FOUNDERS_SESSION_COOKIE)?.value;
    return raw ? verifyFoundersSession(raw) : null;
  })();

  return (
    <Shell>
      <Header slotsLeft={slotsLeft} />
      <Card>
        <p className="text-white text-xl font-bold text-center">{firstName ? `Hi ${firstName}.` : "Hi there."}</p>
        {existing ? (
          <p role="status" className="text-white text-lg font-semibold leading-relaxed text-center">{claimStatusMessage(existing)}</p>
        ) : window === "open" ? (
          slotsLeft <= 0 ? (
            <p className="text-white text-lg font-semibold text-center">{SOLD_OUT_MESSAGE}</p>
          ) : (
            <ClaimFlow token={rawToken} startAt={session?.ghlAccountId === link.ghlAccountId ? "claim" : "start"} />
          )
        ) : (
          <Status />
        )}
      </Card>
    </Shell>
  );
}
