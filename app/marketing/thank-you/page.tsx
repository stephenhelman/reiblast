import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Thank You — REIblast",
};

const PRODUCT_INFO: Record<
  string,
  {
    name: string;
    icon: string;
    description: string;
    nextSteps: string[];
  }
> = {
  a2p: {
    name: "A2P Done-For-You Setup",
    icon: "📱",
    description:
      "Your A2P registration is in the queue. " +
      "We'll reach out within 24 hours to " +
      "collect your business details and kick " +
      "off the setup process. Carrier approval " +
      "typically takes 2-4 weeks from submission.",
    nextSteps: [
      "Watch for an email from us within 24 hours",
      "Have your LLC name and EIN ready",
      "We'll handle everything else from there",
    ],
  },
  "acq-bot": {
    name: "AI Acquisitions Bot",
    icon: "🤖",
    description:
      "Your AI Acquisitions Bot will be " +
      "configured and added to your REIblast " +
      "account within 24-48 hours. You'll " +
      "receive an email with setup " +
      "instructions once it's ready.",
    nextSteps: [
      "Watch for a setup email within 24-48 hours",
      "Your bot will be pre-loaded with Ari's NEPQ sequences",
      "You'll be able to customize settings from your dashboard",
    ],
  },
  "dispo-bot": {
    name: "AI Dispositions Bot",
    icon: "🏠",
    description:
      "Your AI Dispositions Bot will be " +
      "configured and added to your REIblast " +
      "account within 24-48 hours. You'll " +
      "receive an email with setup " +
      "instructions once it's ready.",
    nextSteps: [
      "Watch for a setup email within 24-48 hours",
      "Have your buyer list ready to import",
      "Your bot will be pre-loaded and ready to blast",
    ],
  },
  contracts: {
    name: "State Contract Bundle",
    icon: "📄",
    description:
      "Your state contracts will be loaded " +
      "into your REIblast account within " +
      "24-48 hours. You'll receive a " +
      "confirmation email once they're " +
      "live in your dashboard.",
    nextSteps: [
      "Watch for a confirmation email within 24-48 hours",
      "Contracts will appear in your Documents section",
      "Pre-loaded with merge fields — just fill and send",
    ],
  },
  "ask-ari": {
    name: "Ask Ari AI",
    icon: "🧠",
    description:
      "Ask Ari AI will be activated in " +
      "your REIblast account within " +
      "24-48 hours. You'll receive an " +
      "email when it's ready to use.",
    nextSteps: [
      "Watch for an activation email within 24-48 hours",
      "Available 24/7 directly from your dashboard",
      "Ask anything about wholesaling, deals, or the system",
    ],
  },
};

const DEFAULT_INFO = {
  name: "Your Purchase",
  icon: "✅",
  description:
    "Thank you for your purchase. Your " +
    "add-on will be added to your account " +
    "within 24-48 hours. We'll send a " +
    "confirmation email once it's ready.",
  nextSteps: [
    "Watch for a confirmation email within 24-48 hours",
    "Your add-on will appear in your REIblast dashboard",
    "Questions? Contact support below",
  ],
};

export default function ThankYouPage({
  searchParams,
}: {
  searchParams: { product?: string };
}) {
  const product = searchParams.product || "";
  const info = PRODUCT_INFO[product] || DEFAULT_INFO;

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
          <div className="text-5xl mb-4">{info.icon}</div>

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
          <h1 className="text-3xl font-bold text-white mb-2">Thank You!</h1>
          <p className="text-gold font-semibold text-lg mb-5">
            You purchased {info.name}
          </p>

          {/* Description */}
          <p
            className="text-gray-400 text-base mb-8"
            style={{ lineHeight: 1.75 }}
          >
            {info.description}
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
              {info.nextSteps.map((step, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3"
                  style={{
                    marginBottom: i < info.nextSteps.length - 1 ? 10 : 0,
                  }}
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
            href="https://app.reiblast.app"
            className="block w-full bg-gold text-black font-bold text-lg py-4 rounded-xl hover:bg-gold-hover transition-colors text-center"
          >
            Go to My Dashboard →
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
              href="mailto:support@mail.reiblast.app"
              className="text-gold hover:underline"
            >
              support@mail.reiblast.app
            </a>
          </p>
        </div>
      </div>
    </>
  );
}
