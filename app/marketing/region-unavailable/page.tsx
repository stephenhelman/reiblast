import type { Metadata } from "next";
import Link from "next/link";
import { LogoStacked } from "@/components/shared/Logo";
import { REGION_CONTACT_EMAIL } from "@/lib/geo";

export const metadata: Metadata = {
  title: "Not Available In Your Region — REIblast",
  robots: { index: false, follow: false },
};

export default function RegionUnavailablePage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 py-20">
      <div
        className="w-full text-center"
        style={{
          maxWidth: 520,
          background: "#141414",
          border: "1px solid rgba(245,200,66,0.3)",
          borderRadius: 20,
          padding: 48,
        }}
      >
        <div className="flex justify-center mb-8">
          <Link href="/">
            <LogoStacked size={72} />
          </Link>
        </div>

        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">
          Region Unavailable
        </p>

        <h1 className="text-3xl font-bold text-white mb-4">
          REIblast isn&apos;t available in your region
        </h1>

        <p className="text-gray-400 text-base mb-8" style={{ lineHeight: 1.75 }}>
          Signups are currently limited to the United States. If you believe this
          is an error, or you&apos;d like more information, get in touch and
          we&apos;ll take a look.
        </p>

        <a
          href={`mailto:${REGION_CONTACT_EMAIL}`}
          className="block w-full bg-gold text-black font-bold text-lg py-4 rounded-xl hover:bg-gold-hover transition-colors text-center"
        >
          Contact {REGION_CONTACT_EMAIL}
        </a>

        <Link
          href="/"
          className="block w-full mt-3 py-4 rounded-xl font-semibold text-white/60 hover:text-white transition-colors text-center"
          style={{ border: "1px solid rgba(255,255,255,0.15)" }}
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
