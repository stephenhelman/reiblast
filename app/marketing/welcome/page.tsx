import type { Metadata } from "next";
import Script from "next/script";
import { MARKETING_URL } from "@/lib/constants";
import BookingModal from "@/components/welcome/BookingModal";

export const metadata: Metadata = {
  title: "Welcome — REIblast",
};

// The HQ onboarding-call booking widget — the one real embed in this funnel.
// Swap this src for the real HQ calendar embed. `redirect_url` is the
// LeadConnector/GHL booking-widget convention for a post-booking redirect —
// pre-wired to /discovery so it survives pasting in the real calendar ID; if
// the real embed doesn't honor that param, set the same redirect in the HQ
// calendar's own settings instead (a cross-origin iframe can't be redirected
// from this page's code either way).
const HQ_BOOKING_EMBED_SRC =
  "https://api.leadconnectorhq.com/widget/booking/SZCqdNbCvvAAH0nWli5b";
const discoveryRedirectUrl = `${MARKETING_URL}/discovery`;
const bookingSrc = `${HQ_BOOKING_EMBED_SRC}?redirect_url=${encodeURIComponent(discoveryRedirectUrl)}`;

// Pre-auth, marketing-host, mobile-first (leads hit this from an email/text
// link on a phone) — the opposite of the tools app's desktop-only gate.
// Watch-then-book — NOT a success confirmation. Onboarding-submit flows
// straight through here to /discovery; there is no dead-end screen anymore.
export default function WelcomePage() {
  const ariVslLink = process.env.ARI_VSL_LINK?.trim();
  const hasVsl = !!ariVslLink;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center px-4 sm:px-6 py-12 sm:py-20 gap-6 sm:gap-8">
      {/*
        Ari VSL slot — message and video share this SAME outer card (fixed
        max-width/padding/border) so swapping ARI_VSL_LINK in doesn't shift
        the page; only what's inside the slot changes. Widened + full-width
        on mobile per the embed-container sizing fix.
      */}
      <div className="w-full max-w-[880px] bg-surface border border-border-default rounded-[20px] p-5 sm:p-10">
        <p className="text-gold text-xs font-bold uppercase tracking-widest text-center mb-2">
          Welcome
        </p>
        <h2 className="text-white text-xl sm:text-2xl font-bold text-center mb-6">
          A Quick Message from Ari
        </h2>

        {hasVsl ? (
          <div
            className="rounded-xl overflow-hidden border border-border-default bg-black scrollbar-hide"
            style={{ aspectRatio: "16 / 9", overflow: "auto" }}
          >
            <iframe
              src={ariVslLink}
              className="w-full h-full border-0 block"
              allow="autoplay; fullscreen"
              allowFullScreen
            />
            <Script
              src="https://link.msgsndr.com/js/form_embed.js"
              strategy="afterInteractive"
            />
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-center gap-6 min-h-auto md:min-h-55">
            {/* Text — full width on mobile, left column on desktop */}
            <div className="flex-1 text-center md:text-left order-2 md:order-1">
              <p className="text-white/85 text-base leading-relaxed">
                Hey, it&apos;s Ari — welcome to REIblast! I&apos;m glad
                you&apos;re here. Over the next few minutes you&apos;ll book
                your onboarding call, and from there we&apos;ll get your CRM
                dialed in together. Take a look at REItools below too —
                it&apos;s worth bringing up on the call.
              </p>
            </div>

            {/* Photo — above the text on mobile, right column on desktop (placeholder slot) */}
            <div
              className="shrink-0 order-1 md:order-2 flex items-center justify-center text-white/40 h-32 w-32 sm:h-40 sm:w-40 rounded-full border border-dashed border-gold/35 bg-black"
              aria-label="Ari's photo — placeholder"
            >
              <span className="text-3xl">👤</span>
            </div>
          </div>
        )}
      </div>

      {/* Book your onboarding call — opens the embed in a modal, matching the standard GHL-embed pattern */}
      <div className="w-full max-w-[880px] bg-surface border border-gold/30 rounded-[20px] p-5 sm:p-10 flex flex-col items-center">
        <p className="text-gold text-xs font-bold uppercase tracking-widest text-center mb-2">
          Next Step
        </p>
        <h2 className="text-white text-xl sm:text-2xl font-bold text-center mb-2">
          Book Your Onboarding Call
        </h2>
        <p className="text-gray-400 text-sm text-center mb-6">
          Grab a spot on the calendar and we&apos;ll walk through your account
          together.
        </p>

        <BookingModal bookingSrc={bookingSrc} />
      </div>
    </div>
  );
}
