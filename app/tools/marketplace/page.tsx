"use client";

import { useEffect, useState, Suspense } from "react";
import MinimalHeader from "@/components/tools/MinimalHeader";
import { useLocationId } from "@/lib/hooks/use-location-id";

const A2P_FEATURES = [
  "Custom domain purchase and setup",
  "Cloudflare DNS configuration",
  "A2P compliance website",
  "Brand and campaign registration",
  "Email sending domain setup",
];

const COMING_SOON_ADDONS = [
  {
    name: "AI Acquisitions Bot",
    description:
      "NEPQ-trained AI that qualifies sellers via SMS automatically.",
  },
  {
    name: "AI Dispositions Bot",
    description:
      "Blast deals to cash buyers and manage responses automatically.",
  },
  {
    name: "State Contract Bundle",
    description:
      "Attorney-reviewed contracts for the top 10 wholesale markets.",
  },
  {
    name: "Ask Ari AI",
    description:
      "Wish you had an experienced wholesaler over your shoulder? Ask Ari AI is here to help. Available 24/7.",
  },
];

const ADDON_ROWS = [
  { slug: "a2p", label: "A2P Setup", comingSoon: false },
  { slug: "acq-bot", label: "AI Acquisitions Bot", comingSoon: true },
  { slug: "dispo-bot", label: "AI Dispositions Bot", comingSoon: true },
  { slug: "contracts", label: "State Contracts", comingSoon: true },
  { slug: "ask-ari", label: "Ask Ari AI", comingSoon: true },
];

function SkeletonCards() {
  return (
    <div className="space-y-4">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl"
          style={{
            background: "#141414",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 28,
            height: 180,
          }}
        >
          <div
            className="rounded-full mb-4"
            style={{
              width: 80,
              height: 20,
              background: "rgba(255,255,255,0.07)",
            }}
          />
          <div
            className="rounded mb-3"
            style={{
              width: "60%",
              height: 24,
              background: "rgba(255,255,255,0.07)",
            }}
          />
          <div
            className="rounded"
            style={{
              width: "40%",
              height: 16,
              background: "rgba(255,255,255,0.05)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function GreenCheckCircle({ size }: { size: number }) {
  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "rgba(34,197,94,0.1)",
        border: "1px solid rgba(34,197,94,0.3)",
      }}
    >
      <span style={{ color: "#4ade80", fontWeight: 700, fontSize: size * 0.4 }}>
        ✓
      </span>
    </div>
  );
}

function MarketplaceContent() {
  const locationId = useLocationId();

  const [addons, setAddons] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) {
      setError("Unable to load your account. Please try again.");
      setLoading(false);
      return;
    }

    fetch(
      `/api/marketplace/addons?locationId=${encodeURIComponent(locationId)}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((data) => {
        setAddons(data.addons ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError("Unable to load your account. Please try again.");
        setLoading(false);
      });
  }, [locationId]);

  const hasA2P = addons.includes("a2p");

  return (
    <div className="min-h-screen bg-black">
      <MinimalHeader title="Marketplace" />

      <div className="px-6 py-12" style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Page header */}
        <h1 className="text-white font-bold text-3xl mb-2">
          REIblast Marketplace
        </h1>
        <p className="text-white/50 text-base mb-12">
          Add tools to your wholesale system.
        </p>

        {/* Error state */}
        {error && !loading && (
          <div className="flex items-center justify-center py-20">
            <div
              className="text-center"
              style={{
                background: "#141414",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 16,
                padding: 40,
                maxWidth: 400,
                width: "100%",
              }}
            >
              <p className="text-white/50 text-base mb-6">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="bg-gold text-black font-bold py-3 px-8 rounded-xl hover:bg-gold-hover transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Main layout */}
        {!error && (
          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8 items-start">
            {/* ── LEFT ── */}
            <div>
              <p className="text-gold text-xs font-bold uppercase tracking-widest mb-5">
                Add-Ons
              </p>

              {loading ? (
                <SkeletonCards />
              ) : (
                <>
                  {/* A2P card */}
                  {hasA2P ? (
                    /* PURCHASED STATE */
                    <div
                      style={{
                        background: "#141414",
                        border: "1px solid rgba(34,197,94,0.4)",
                        borderRadius: 16,
                        padding: 28,
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full"
                            style={{
                              background: "rgba(34,197,94,0.1)",
                              color: "#4ade80",
                              border: "1px solid rgba(34,197,94,0.3)",
                            }}
                          >
                            ✓ Active
                          </span>
                          <p className="text-white font-bold text-xl mt-2">
                            A2P Done-For-You Setup
                          </p>
                        </div>
                        <GreenCheckCircle size={44} />
                      </div>
                      <p
                        className="text-white/60 text-sm mt-4"
                        style={{ lineHeight: 1.7 }}
                      >
                        Your A2P registration is active. SMS sending is enabled
                        on your account.
                      </p>
                      <a
                        href="mailto:support@reiblast.app"
                        className="inline-block text-gold text-sm mt-3 hover:underline"
                      >
                        Need help with your A2P setup?
                      </a>
                    </div>
                  ) : (
                    /* AVAILABLE STATE */
                    <div
                      style={{
                        background: "#141414",
                        border: "1px solid #F5C842",
                        borderRadius: 16,
                        padding: 28,
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <span
                            className="inline-block text-xs font-bold px-2.5 py-1 rounded-full"
                            style={{
                              border: "1px solid #F5C842",
                              color: "#F5C842",
                            }}
                          >
                            ADD-ON
                          </span>
                          <p className="text-white font-bold text-xl mt-2">
                            A2P Done-For-You Setup
                          </p>
                          <div className="flex items-baseline gap-2 mt-1.5">
                            <span className="text-gold font-bold text-2xl">
                              $100
                            </span>
                            <span className="text-white/40 text-sm">
                              one-time
                            </span>
                          </div>
                        </div>
                        <div
                          className="flex items-center justify-center shrink-0"
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: "50%",
                            background: "rgba(245,200,66,0.1)",
                            border: "1px solid rgba(245,200,66,0.3)",
                          }}
                        >
                          <span style={{ color: "#F5C842", fontSize: 18 }}>
                            →
                          </span>
                        </div>
                      </div>

                      {/* Amber warning */}
                      <div
                        className="flex items-start gap-2 mt-4 rounded-lg px-3 py-2"
                        style={{
                          background: "rgba(245,158,11,0.1)",
                          border: "1px solid rgba(245,158,11,0.2)",
                        }}
                      >
                        <span className="text-amber-400 shrink-0 text-sm">
                          ⚠
                        </span>
                        <p
                          className="text-xs font-semibold"
                          style={{ color: "rgba(252,211,77,0.8)" }}
                        >
                          SMS sending is currently disabled on your account. A2P
                          registration is required.
                        </p>
                      </div>

                      {/* Feature list */}
                      <ul className="mt-4 space-y-2">
                        {A2P_FEATURES.map((f) => (
                          <li
                            key={f}
                            className="flex items-start gap-2 text-sm text-white/70"
                          >
                            <span className="text-gold mt-0.5 shrink-0">•</span>
                            {f}
                          </li>
                        ))}
                      </ul>

                      {/* CTA */}
                      <button
                        onClick={() =>
                          window.open(
                            process.env.NEXT_PUBLIC_CHECKOUT_URL_A2P || "#",
                            "_blank",
                          )
                        }
                        className="mt-5 w-full bg-gold text-black font-bold text-base py-4 rounded-xl hover:bg-gold-hover transition-colors"
                      >
                        Add to REIblast — $100 →
                      </button>
                    </div>
                  )}

                  {/* Coming soon cards */}
                  <div className="mt-8">
                    <p className="text-white/30 text-xs font-bold uppercase tracking-widest mb-5">
                      Coming Soon
                    </p>
                    <div className="space-y-3">
                      {COMING_SOON_ADDONS.map((item) => (
                        <div
                          key={item.name}
                          className="opacity-50 cursor-not-allowed"
                          style={{
                            background: "#141414",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 12,
                            padding: 24,
                          }}
                        >
                          <span
                            className="inline-block text-xs font-bold px-2.5 py-1 rounded-full"
                            style={{
                              border: "1px solid rgba(255,255,255,0.2)",
                              color: "rgba(255,255,255,0.4)",
                            }}
                          >
                            COMING SOON
                          </span>
                          <p className="text-white font-bold text-base mt-3 mb-1">
                            {item.name}
                          </p>
                          <p className="text-white/50 text-sm">
                            {item.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ── RIGHT ── */}
            <div className="lg:sticky lg:top-24">
              <div
                style={{
                  background: "#141414",
                  border: "1px solid #F5C842",
                  borderRadius: 16,
                  padding: 28,
                }}
              >
                <p className="text-white font-bold text-base mb-5">
                  Your Account
                </p>

                {/* Core status */}
                <div className="flex items-center gap-3 mb-5">
                  <GreenCheckCircle size={36} />
                  <div>
                    <p className="text-white font-semibold text-base leading-none">
                      REIblast Core
                    </p>
                    <p className="text-green-400 text-xs mt-1">Active</p>
                  </div>
                </div>

                <div className="border-t border-white/10 mb-5" />

                {/* Add-ons list */}
                <p className="text-white/60 text-sm mb-3">Add-Ons</p>

                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="animate-pulse rounded"
                        style={{
                          height: 20,
                          background: "rgba(255,255,255,0.05)",
                        }}
                      />
                    ))}
                  </div>
                ) : addons.length === 0 &&
                  !ADDON_ROWS.some(
                    (r) => !r.comingSoon && addons.includes(r.slug),
                  ) ? (
                  <>
                    <p className="text-white/30 text-sm italic mb-2">
                      No add-ons yet.
                    </p>
                    {ADDON_ROWS.filter((r) => r.comingSoon).map((row) => (
                      <div
                        key={row.slug}
                        className="flex items-center gap-2.5 mb-2"
                      >
                        <span
                          className="shrink-0 rounded-full"
                          style={{
                            width: 8,
                            height: 8,
                            background: "rgba(255,255,255,0.15)",
                          }}
                        />
                        <span className="text-white/30 text-sm">
                          {row.label}
                        </span>
                        <span
                          className="ml-auto text-xs px-2 py-0.5 rounded-full"
                          style={{
                            border: "1px solid rgba(255,255,255,0.15)",
                            color: "rgba(255,255,255,0.3)",
                          }}
                        >
                          Coming Soon
                        </span>
                      </div>
                    ))}
                  </>
                ) : (
                  ADDON_ROWS.map((row) => {
                    const owned = addons.includes(row.slug);
                    return (
                      <div
                        key={row.slug}
                        className="flex items-center gap-2.5 mb-2"
                      >
                        <span
                          className="shrink-0 rounded-full"
                          style={{
                            width: 8,
                            height: 8,
                            background: owned
                              ? "#4ade80"
                              : "rgba(255,255,255,0.15)",
                          }}
                        />
                        <span
                          className="text-sm"
                          style={{
                            color: owned
                              ? "rgba(255,255,255,0.7)"
                              : "rgba(255,255,255,0.3)",
                          }}
                        >
                          {row.label}
                        </span>
                        {row.comingSoon && (
                          <span
                            className="ml-auto text-xs px-2 py-0.5 rounded-full"
                            style={{
                              border: "1px solid rgba(255,255,255,0.15)",
                              color: "rgba(255,255,255,0.3)",
                            }}
                          >
                            Coming Soon
                          </span>
                        )}
                      </div>
                    );
                  })
                )}

                <div className="border-t border-white/10 mt-5 mb-5" />

                {/* Support */}
                <p className="text-white/40 text-xs mb-1.5">Need help?</p>
                <a
                  href="mailto:support@reiblast.app"
                  className="text-gold text-xs hover:underline"
                >
                  support@reiblast.app
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <MarketplaceContent />
    </Suspense>
  );
}
