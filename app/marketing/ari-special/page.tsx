import type { Metadata } from "next";
import { LogoFull } from "@/components/shared/Logo";
import AriSpecialOffer from "./AriSpecialOffer";

export const metadata: Metadata = {
  title: "Get Started — REIblast",
  robots: { index: false, follow: false },
};

const ARI_CHECKOUT_LINK = process.env.NEXT_PUBLIC_ARI_CHECKOUT_LINK;

function NotFound() {
  // Deliberately generic — doesn't hint that a promo-gated page exists here.
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <p className="text-white/40 text-sm">Page not found.</p>
    </div>
  );
}

export default function AriSpecialPage({
  searchParams,
}: {
  searchParams: { promo?: string };
}) {
  const promo = searchParams.promo || "";
  const expected = process.env.ARI_PROMO_CODE;

  if (!expected || promo !== expected) {
    return <NotFound />;
  }

  return (
    <div className="min-h-screen bg-black px-6 pt-32 pb-12">
      <div className="max-w-2xl mx-auto text-center">
        <div className="flex flex-col items-center mb-8">
          <LogoFull size={28} />
        </div>

        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">
          Limited Time
        </p>
        <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
          Welcome to the special discount!
        </h1>
        <p className="text-white/60 text-base mb-10 leading-relaxed">
          Click below to claim your special offer.
        </p>

        <AriSpecialOffer formUrl={ARI_CHECKOUT_LINK} />
      </div>
    </div>
  );
}
