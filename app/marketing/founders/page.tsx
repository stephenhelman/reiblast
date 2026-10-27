import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { LogoFull } from "@/components/shared/Logo";
import { SETUP_FEE } from "@/lib/pricing";
import { FOUNDER_TRIAL_DAYS, getFounderCheckoutLink, isFounderOfferOpen } from "@/lib/founderOffer";
import FoundersCheckout from "./FoundersCheckout";

// Evaluated on every request so the page closes at the deadline (or on the kill switch) without a redeploy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founding Membership — REIblast",
  robots: { index: false, follow: false },
};

const MEMBER_PERKS = [
  {
    title: "Member Community",
    body: "A private Discord of investors running the same system.",
  },
  {
    title: "24/7 AI Support",
    body: "Account questions answered any time, right in Discord.",
  },
  {
    title: "Support Courses",
    body: "Step-by-step, from setup to your first campaign.",
  },
  {
    title: "Live Group Sessions",
    body: "Get help on your actual account, live.",
  },
];

const FOUNDER_SLOTS = 10;

/** Isolated so a live remaining-slots counter can replace the static copy later. */
function FounderSlots() {
  return (
    <p className="text-gold font-semibold text-center">
      Only {FOUNDER_SLOTS} founder slots. After that, REIsite is $500 and REIkit is $25.
    </p>
  );
}

function OfferCard({
  wordmark,
  width,
  height,
  alt,
  description,
  was,
  now,
  priceLabel,
  note,
  included = false,
}: {
  wordmark: string;
  width: number;
  height: number;
  alt: string;
  description: string;
  was: string;
  now: string;
  priceLabel?: string;
  note?: string;
  /** An add-in of another product, not something to buy: quieter card, no price emphasis. */
  included?: boolean;
}) {
  return (
    <div className={`bg-surface rounded-xl p-6 flex flex-col border ${included ? "border-border-default" : "border-gold/30"}`}>
      <Image src={wordmark} alt={alt} width={width} height={height} className="h-10 w-auto self-start" />
      <p className="text-white/60 text-sm leading-relaxed mt-4 flex-1">{description}</p>
      <div className="mt-5 flex items-baseline gap-3 flex-wrap">
        <span className="text-gray line-through text-lg">{was}</span>
        <span className="text-gold font-extrabold text-3xl">{now}</span>
        {priceLabel && <span className="text-silver text-xs uppercase tracking-widest">{priceLabel}</span>}
      </div>
      {note && (
        <p className="mt-3 text-xs font-bold px-2.5 py-1 rounded-full bg-gold text-black self-start">{note}</p>
      )}
    </div>
  );
}

export default function FoundersPage() {
  const formUrl = getFounderCheckoutLink();
  if (!isFounderOfferOpen() || !formUrl) redirect("/signup");

  return (
    <div className="min-h-screen bg-black px-6 pt-32 pb-16">
      <div className="max-w-3xl mx-auto">
        {/* Hero */}
        <section className="text-center">
          <div className="flex justify-center mb-8">
            <LogoFull size={28} />
          </div>
          <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">
            Founding Membership · Ends Oct 31
          </p>
          <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
            Become a REIblast Founding Member
          </h1>
          <p className="text-white/60 text-base md:text-lg mb-8 leading-relaxed max-w-xl mx-auto">
            Join the first investors on REIblast and lock in founder pricing on your own investor website.
          </p>
          <FoundersCheckout formUrl={formUrl} label={`Start your ${FOUNDER_TRIAL_DAYS}-day free trial`} />
          <p className="text-gray text-sm mt-4">
            One-time ${SETUP_FEE} setup fee covers your account provisioning.
          </p>
        </section>

        {/* Member perks */}
        <section className="mt-20">
          <p className="text-gold text-xs font-bold uppercase tracking-widest mb-5 text-center">
            What every member gets
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {MEMBER_PERKS.map((p) => (
              <div key={p.title} className="bg-surface border border-border-default rounded-xl p-6">
                <p className="text-white font-bold text-lg">{p.title}</p>
                <p className="text-white/60 text-sm leading-relaxed mt-1">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Founder's Offer */}
        <section className="mt-20">
          <p className="text-gold text-xs font-bold uppercase tracking-widest mb-2 text-center">
            The Founder&apos;s Offer
          </p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-white text-center mb-8">
            Founder pricing on REIsite, with REIkit included free
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <OfferCard
              wordmark="/brand/wordmarks/rei-site.png"
              width={412}
              height={127}
              alt="REIsite"
              description="Your own real estate investor website: full site, SEO, and lead capture straight into REIblast. Live within 3 days of receiving your intake."
              was="$500"
              now="$100"
              priceLabel="founder price"
              note="REIkit included free"
            />
            <OfferCard
              wordmark="/brand/wordmarks/rei-kit.png"
              width={382}
              height={128}
              alt="REIkit"
              description="Logo + brand kit, included with your REIsite at no extra cost. REIkit isn't sold separately."
              was="$25"
              now="Free"
              priceLabel="founder price"
              note="Included with REIsite"
              included
            />
          </div>
          <div className="mt-6 space-y-2">
            <FounderSlots />
            <p className="text-silver text-sm text-center">
              Members active or on trial by October 31 qualify. Paused or expired accounts don&apos;t.
            </p>
          </div>
        </section>

        {/* Existing members */}
        <section className="mt-12 bg-surface-2 border border-border-default rounded-xl p-6 text-center">
          <p className="text-white font-bold text-lg">Already a member?</p>
          <p className="text-white/60 text-sm leading-relaxed mt-1">
            You already qualify. Founder claims open Wednesday, October 28 at 7 PM CT.
          </p>
        </section>

        {/* Repeat CTA */}
        <section className="mt-16 text-center">
          <FoundersCheckout formUrl={formUrl} label={`Start your ${FOUNDER_TRIAL_DAYS}-day free trial`} />
          <p className="text-gray text-sm mt-4">
            One-time ${SETUP_FEE} setup fee covers your account provisioning.
          </p>
        </section>

        <p className="text-gray text-xs text-center mt-16 leading-relaxed">
          REIsite, REIkit, and account setup are provided by OP Web Studio, a subsidiary of Operation Profit LLC.
        </p>
      </div>
    </div>
  );
}
