import type { Metadata } from "next";
import Script from "next/script";
import { LogoFull } from "@/components/shared/Logo";

export const metadata: Metadata = {
  title: "Get Started — REIblast",
  robots: { index: false, follow: false },
};

const ARI_CHECKOUT_LINK = process.env.NEXT_PUBLIC_ARI_CHECKOUT_LINK;
const FORM_ID = ARI_CHECKOUT_LINK?.split("/").pop() ?? "";

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
    <div className="min-h-screen bg-black px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col items-center text-center mb-8">
          <LogoFull size={28} />
        </div>

        {ARI_CHECKOUT_LINK ? (
          <div style={{ width: "100%", height: 635, background: "#141414", borderRadius: 8 }}>
            <iframe
              src={ARI_CHECKOUT_LINK}
              style={{ width: "100%", height: "100%", border: "none", borderRadius: 8 }}
              id={`inline-${FORM_ID}`}
              data-layout="{'id':'INLINE'}"
              data-trigger-type="alwaysShow"
              data-trigger-value=""
              data-activation-type="alwaysActivated"
              data-activation-value=""
              data-deactivation-type="neverDeactivate"
              data-deactivation-value=""
              data-form-name="30 Day Trial"
              data-height="635"
              data-layout-iframe-id={`inline-${FORM_ID}`}
              data-form-id={FORM_ID}
              data-cookie-consent="true"
              data-cookie-consent-provider="auto"
              title="30 Day Trial"
            />
          </div>
        ) : (
          <p className="text-white/50 text-sm text-center py-20">
            Checkout temporarily unavailable — contact support@reiblast.app
          </p>
        )}
      </div>
      <Script src="https://link.msgsndr.com/js/form_embed.js" strategy="afterInteractive" />
    </div>
  );
}
