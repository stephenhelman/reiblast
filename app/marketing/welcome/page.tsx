import type { Metadata } from "next";
import Script from "next/script";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_SMS_HREF } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Welcome — REIblast",
};

// Pre-auth, marketing-host, mobile-first (leads hit this from an email/text
// link on a phone) — the opposite of the tools app's desktop-only gate.
// Static and anonymous by design: no member lookup, so every line is worded for
// every member (e.g. the setup-fee note is conditional).

const BTN =
  "inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-4 text-lg rounded-xl font-semibold transition-colors duration-150";
const BTN_GOLD = `${BTN} bg-gold text-black hover:bg-gold-hover font-bold`;
// Same classes as Button variant="outline" size="lg" — Button renders a <button>, so it can't carry an href.
const BTN_OUTLINE = `${BTN} border border-gold text-gold bg-transparent hover:bg-gold/10`;

const VERIFY_STEPS = [
  "Press Verify",
  "Enter your signup email",
  "Enter the code we text you",
  "Agree to the rules",
  "You get the REIblast role",
];

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="w-full max-w-[880px] bg-surface border border-border-default rounded-[20px] p-5 sm:p-10">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="shrink-0 flex items-center justify-center h-9 w-9 rounded-full border border-gold text-gold font-bold"
        >
          {n}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white text-xl sm:text-2xl font-bold mb-2">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h2>
          {children}
        </div>
      </div>
    </section>
  );
}

export default function WelcomePage() {
  const ariVslLink = process.env.ARI_VSL_LINK?.trim();
  const hasVsl = !!ariVslLink;
  const discordInviteUrl = process.env.DISCORD_INVITE_URL?.trim();
  const verifyChannel = process.env.DISCORD_VERIFY_CHANNEL?.trim() || "verify";
  const verifyVideoUrl = process.env.VERIFY_VIDEO_URL?.trim();

  return (
    <div className="min-h-screen bg-black flex flex-col items-center px-4 sm:px-6 py-12 sm:py-20 gap-6 sm:gap-8">
      <header className="w-full max-w-[880px] text-center">
        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-2">
          Welcome
        </p>
        <h1 className="text-white text-2xl sm:text-4xl font-bold">
          You&apos;re in. Here&apos;s what to do next.
        </h1>
      </header>

      <Step n={1} title="Text us">
        <p className="text-gray-400 text-sm sm:text-base mb-6">
          Text us now so our messages reach you. This saves our number on your
          phone so your setup texts and invoice don&apos;t land in spam.
        </p>
        <a href={SUPPORT_SMS_HREF} className={BTN_OUTLINE}>
          Text Us Now
        </a>
        <p className="text-gray-400 text-sm mt-4">
          Text us at{" "}
          <span className="text-white font-semibold">{SUPPORT_PHONE_DISPLAY}</span>
        </p>
        <p className="text-gray-500 text-xs sm:text-sm mt-3">
          If you signed up with a $97 setup fee, your invoice will come by text
          and email. We release your account access once it&apos;s paid.
        </p>
      </Step>

      <Step n={2} title="Join the REIblast Discord">
        <p className="text-gray-400 text-sm sm:text-base mb-6">
          Your community, 24/7 AI support, and live Support Group Sessions are
          all there.
        </p>
        {discordInviteUrl ? (
          <a
            href={discordInviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={BTN_GOLD}
          >
            Join the Discord
          </a>
        ) : (
          <p className="text-white/85 text-sm sm:text-base">
            Text us for the Discord link.
          </p>
        )}
      </Step>

      <Step n={3} title="Verify your account">
        <p className="text-gray-400 text-sm sm:text-base mb-6">
          In the Discord, go to{" "}
          <span className="text-white font-semibold">#{verifyChannel}</span> and
          press Verify. Use the email you signed up with, and we&apos;ll text
          you a code.
        </p>
        {verifyVideoUrl ? (
          <div
            className="rounded-xl overflow-hidden border border-border-default bg-black"
            style={{ aspectRatio: "16 / 9" }}
          >
            <iframe
              src={verifyVideoUrl}
              title="How to verify your account"
              className="w-full h-full border-0 block"
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          </div>
        ) : (
          <ol className="list-decimal list-inside space-y-1 text-white/85 text-sm sm:text-base">
            {VERIFY_STEPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        )}
        <p className="text-gray-500 text-xs sm:text-sm mt-4">
          Verify not working?{" "}
          <a href={SUPPORT_SMS_HREF} className="text-gold underline">
            Text us
          </a>{" "}
          and we&apos;ll sort it out.
        </p>
      </Step>

      <Step n={4} title="Start your courses">
        <p className="text-gray-400 text-sm sm:text-base">
          Your REIblast courses are already unlocked. Once you&apos;re verified,
          you&apos;ll find direct links to each course in the Discord. Start
          with Onboarding.
        </p>
      </Step>

      <section className="w-full max-w-[880px] bg-surface border border-gold/30 rounded-[20px] p-5 sm:p-10">
        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-2">
          What happens next
        </p>
        <p className="text-white/85 text-base leading-relaxed">
          We&apos;re submitting your A2P messaging registration now. We&apos;ll
          text you as soon as it&apos;s approved, and then your account is ready
          to send.
        </p>
      </section>

      <p className="w-full max-w-[880px] text-center text-gray-400 text-sm">
        Stuck? Post in the Q&amp;A forum in the Discord or{" "}
        <a href={SUPPORT_SMS_HREF} className="text-gold underline">
          text us
        </a>
        .
      </p>

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
                you&apos;re here. Work through the steps above and
                we&apos;ll get your account ready to send. See you in the
                Discord.
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
    </div>
  );
}
