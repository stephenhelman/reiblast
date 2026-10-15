import type { Metadata } from "next";
import { LogoFull } from "@/components/shared/Logo";
import { resolveAriPromo } from "@/lib/ariPromo";
import AriSpecialOffer from "./AriSpecialOffer";

export const metadata: Metadata = {
  title: "Get Started — REIblast",
  robots: { index: false, follow: false },
};

export default function AriSpecialPage({
  searchParams,
}: {
  searchParams: { promo?: string };
}) {
  const promo = searchParams.promo || "";
  const initialTier = resolveAriPromo(promo);

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
          Click below and enter your promo code to claim your special offer.
        </p>

        <AriSpecialOffer initialTier={initialTier} initialCode={promo} />
      </div>
    </div>
  );
}
