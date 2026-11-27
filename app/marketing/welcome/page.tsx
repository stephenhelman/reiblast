import type { Metadata } from "next";
import Script from "next/script";
import BookingModal from "@/components/welcome/BookingModal";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_SMS_HREF } from "@/lib/constants";
import { SETUP_FEE } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Welcome — REIblast",
};

// Pre-auth, marketing-host, mobile-first (leads hit this from an email/text
// link on a phone) — the opposite of the tools app's desktop-only gate.
// Static and anonymous by design: no member lookup, so every line is worded for
// every member (e.g. the setup-fee note is conditional).
// Booking the onboarding call is the ONE primary action. Our number, Discord and
// the setup fee are the call's agenda, not self-serve buttons.

const CALL_AGENDA = [
  {
    title: "Our number",
    body: "We’ll make sure it’s saved, so your setup texts and invoice don’t get missed.",
  },
  {
    title: "The REIblast Discord",
    body: "We’ll get you joined and verified, and show you where your courses are.",
  },
  {
    title: "Your setup payment",
    body: `If your signup included the $${SETUP_FEE} setup fee, it covers account setup and provisioning by OP Web Studio. We release your account access once it’s paid.`,
  },
];

export default function WelcomePage() {
  const ariVslLink = process.env.ARI_VSL_LINK?.trim();
  const hasVsl = !!ariVslLink;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center px-4 sm:px-6 pt-24 sm:pt-28 pb-12 sm:pb-20 gap-6 sm:gap-8">
      <header className="w-full max-w-[880px] text-center">
        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-2">
          Welcome
        </p>
        <h1 className="text-white text-2xl sm:text-4xl font-bold">
          You&apos;re in. Book your onboarding call.
        </h1>
      </header>

      <section className="w-full max-w-[880px] bg-surface border border-gold/30 rounded-[20px] p-5 sm:p-10 flex flex-col items-center">
        <p className="text-gold text-xs font-bold uppercase tracking-widest text-center mb-2">
          Your Next Step
        </p>
        <h2 className="text-white text-xl sm:text-2xl font-bold text-center mb-6">
          Book Your Onboarding Call
        </h2>

        <BookingModal />

        <div className="w-full max-w-[560px] border-t border-border-default mt-8 pt-6">
          <h3 className="text-white text-base font-semibold mb-4">
            What we&apos;ll handle together
          </h3>
          <ul className="list-disc pl-5 space-y-3 marker:text-gold text-gray-400 text-sm sm:text-base leading-relaxed">
            {CALL_AGENDA.map(({ title, body }) => (
              <li key={title}>
                <span className="text-white font-semibold">{title}.</span> {body}
              </li>
            ))}
          </ul>
        </div>
      </section>

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
                you&apos;re here. Book your onboarding call and we&apos;ll get
                your account ready to send. See you in the Discord.
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

      <p className="w-full max-w-[880px] text-center text-gray-400 text-sm">
        Can&apos;t find a time? Text us at{" "}
        <a href={SUPPORT_SMS_HREF} className="text-gold underline whitespace-nowrap">
          {SUPPORT_PHONE_DISPLAY}
        </a>
        .
      </p>
    </div>
  );
}
