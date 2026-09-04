import Link from "next/link";
import Hero from "@/components/marketing/Hero";
import TrialPopup from "@/components/marketing/TrialPopup";

const PAIN_POINTS = [
  "Tired of juggling 3-5 different resources just to get one deal done?",
  "Spending weeks waiting for A2P approval?",
  "No system to go from list to first text in one session?",
];

const STEPS = [
  { number: "01", label: "Get Your List" },
  { number: "02", label: "Blast Your Market" },
  { number: "03", label: "Work Your Leads" },
  { number: "04", label: "Close and Assign" },
];

const STATS = [
  { number: "5-6", label: "Deals closed per month by Ari" },
  { number: "22", label: "Years old. No cold calls. Ever." },
  { number: "30", label: "Days to your first deal (goal)" },
];

export default function HomePage() {
  return (
    <>
      <TrialPopup />
      <Hero />

      {/* Pain points strip */}
      <section className="py-16 px-6 border-y border-border-default bg-surface">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
          {PAIN_POINTS.map((text) => (
            <div
              key={text}
              className="bg-surface border-l-4 border-gold rounded-r-xl px-6 py-5"
            >
              <p className="text-white/80 text-base">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 bg-surface border-b border-border-default">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              How it <span className="text-gold">works</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-4 gap-0">
            {STEPS.map((step, i) => (
              <div
                key={step.number}
                className="flex flex-col items-center text-center relative"
              >
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-1/2 w-full h-px bg-gold/30" />
                )}
                <div className="relative z-10 w-12 h-12 rounded-full bg-gold text-black font-bold text-lg flex items-center justify-center mb-4">
                  {step.number}
                </div>
                <p className="text-white font-semibold text-base">
                  {step.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social proof strip */}
      <section className="py-20 px-6 bg-surface border-b border-border-default">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            {STATS.map((s) => (
              <div key={s.number}>
                <div className="text-6xl font-extrabold text-gold mb-3">
                  {s.number}
                </div>
                <p className="text-white text-base leading-snug">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA section */}
      <section className="py-24 px-6 bg-surface border-b border-border-default text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Ready to build your wholesale business?
          </h2>
          <p className="text-white/50 text-xl mb-10">
            Everything you need is already set up. Just add your list.
          </p>
          <Link
            href="/checkout"
            className="inline-block bg-gold text-black font-bold text-lg px-10 py-4 rounded-xl hover:bg-gold-hover transition-colors"
          >
            Get Started — $57/mo
          </Link>
          <div className="mt-4">
            <Link
              href="/pricing"
              className="text-white/40 text-sm hover:text-white/70 transition-colors"
            >
              See full pricing →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
