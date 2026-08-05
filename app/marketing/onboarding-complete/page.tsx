import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "You're All Set — REIblast",
};

const NEXT_STEPS = [
  "We'll review your business details within 24 hours",
  "You'll receive an email with your CRM login credentials",
  "Your SMS sequences are pre-loaded and ready to fire",
  "Get your first list ready on DealMachine while you wait",
];

export default function OnboardingCompletePage() {
  return (
    <>
      <style>{`
        @keyframes popIn {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .pop-in {
          animation: popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
      `}</style>

      <div className="min-h-screen bg-black flex items-center justify-center px-6 py-20">
        <div
          className="w-full text-center"
          style={{
            maxWidth: 580,
            background: "#141414",
            border: "1px solid rgba(245,200,66,0.3)",
            borderRadius: 20,
            padding: 48,
          }}
        >
          {/* Icon */}
          <div className="text-5xl mb-4">🏠</div>

          {/* Animated checkmark */}
          <div
            className="pop-in mx-auto mb-6 flex items-center justify-center"
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              border: "2px solid #F5C842",
            }}
          >
            <span className="text-gold font-bold text-2xl">✓</span>
          </div>

          {/* Heading */}
          <h1 className="text-3xl font-bold text-white mb-2">
            {"You're All Set!"}
          </h1>
          <p className="text-gold font-semibold text-lg mb-5">
            Your information has been submitted
          </p>

          {/* Description */}
          <p
            className="text-gray-400 text-base mb-8"
            style={{ lineHeight: 1.75 }}
          >
            {"We're reviewing your details and setting up your REIblast account. " +
              "You'll receive an email with your login credentials within 24 hours."}
          </p>

          {/* Next steps */}
          <div
            className="text-left mb-8"
            style={{
              background: "#1C1C1C",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <p
              className="text-white font-semibold text-sm uppercase mb-4"
              style={{ letterSpacing: "0.06em" }}
            >
              What happens next:
            </p>
            <ul className="space-y-0">
              {NEXT_STEPS.map((step, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3"
                  style={{ marginBottom: i < NEXT_STEPS.length - 1 ? 10 : 0 }}
                >
                  <span
                    className="shrink-0 mt-2 rounded-full bg-gold"
                    style={{ width: 6, height: 6 }}
                  />
                  <span
                    className="text-gray-400 text-sm"
                    style={{ lineHeight: 1.65 }}
                  >
                    {step}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Buttons */}
          <a
            href="https://app.dealmachine.com"
            target="_blank"
            rel="noreferrer"
            className="block w-full bg-gold text-black font-bold text-lg py-4 rounded-xl hover:bg-gold-hover transition-colors text-center"
          >
            Get Your First List →
          </a>
          <Link
            href="/"
            className="block w-full mt-3 py-4 rounded-xl font-semibold text-white/60 hover:text-white transition-colors text-center"
            style={{ border: "1px solid rgba(255,255,255,0.15)" }}
          >
            Back to Home
          </Link>

          {/* Support */}
          <p className="text-gray-500 text-sm mt-6">
            Questions?{" "}
            <a
              href="mailto:support@reiblast.app"
              className="text-gold hover:underline"
            >
              support@reiblast.app
            </a>
          </p>
        </div>
      </div>
    </>
  );
}
