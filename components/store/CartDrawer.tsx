"use client";

import { useState } from "react";
import Image from "next/image";
import Drawer from "@/components/shared/Drawer";
import Button from "@/components/shared/Button";
import { formatCents } from "@/lib/money";
import { startCheckoutAction } from "@/app/tools/store/actions";
import CheckoutForm from "./CheckoutForm";
import BundleNudgeModal from "./BundleNudgeModal";
import { computeBundleNudge } from "./bundleNudge";
import { getBrandAssets, portalBrand, creditsBrand } from "@/lib/brandAssets";
import { brandSlugFor } from "@/lib/brandSlug";
import type { StoreBundle, StorePack, StoreTool } from "@/types/store";
import type { CartItem } from "./cartTypes";

// Solo tool subs carry a featureSlug that maps 1:1 to a brand wordmark;
// credit packs get their own dedicated mark; bundles have no single tool to
// represent, so they fall back to the umbrella REI/tools mark.
function wordmarkFor(item: CartItem): string {
  if (item.featureSlug) return getBrandAssets(brandSlugFor(item.featureSlug)).wordmark;
  if (item.kind === "credits") return creditsBrand.wordmark;
  return portalBrand.wordmark;
}

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  bundles: StoreBundle[];
  tools: StoreTool[];
  packs: StorePack[];
  membershipName: string;
  onRemove: (id: string) => void;
  onApplySwap: (bundle: StoreBundle) => void;
  stripePublishableKey: string;
}

const KIND_LABEL: Record<CartItem["kind"], string> = {
  sub: "Subscription",
  once: "One-time",
  credits: "Credit pack",
};

export default function CartDrawer({
  open,
  onClose,
  cart,
  bundles,
  tools,
  packs,
  membershipName,
  onRemove,
  onApplySwap,
  stripePublishableKey,
}: CartDrawerProps) {
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [nudgeOpen, setNudgeOpen] = useState(false);

  // A bundle cart item fans out to N tool_sub lines (never one Price) —
  // checkout needs every line's own priceId, not the group item's (which is
  // null; its Price lives on `lines`).
  const priceIds = cart.flatMap((item) => (item.lines ? item.lines.map((l) => l.stripePriceId) : [item.stripePriceId]));
  const allItemsCheckoutEligible =
    cart.length > 0 && priceIds.every((id): id is string => !!id);

  const handleCheckout = async () => {
    if (!allItemsCheckoutEligible) return;
    setCheckoutLoading(true);
    setCheckoutError(null);
    const result = await startCheckoutAction(priceIds as string[]);
    setCheckoutLoading(false);
    if ("error" in result) {
      setCheckoutError(result.error);
      return;
    }
    setClientSecret(result.clientSecret);
    // One dialog on screen at a time — the checkout modal takes over from here
    // (it's portaled independently, so it stays mounted after this closes).
    onClose();
  };

  const nudge = computeBundleNudge(cart, bundles, packs);

  const monthlyCents = cart
    .filter((i) => i.kind === "sub")
    .reduce((sum, i) => sum + i.priceCents, 0);
  const oneTimeCents = cart
    .filter((i) => i.kind !== "sub")
    .reduce((sum, i) => sum + i.priceCents, 0);

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        side="right"
        className="flex! flex-col p-0! max-w-105!"
      >
        <div className="flex items-center justify-between px-5.5 py-5 border-b border-border-default">
          <h2 className="text-lg font-semibold font-display">Your cart</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray hover:text-white text-2xl leading-none px-1.5"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5.5 py-4 flex flex-col gap-3">
          {cart.length === 0 ? (
            <div className="text-gray text-sm text-center mt-10">
              Your cart is empty.
            </div>
          ) : (
            cart.map((item) =>
              item.lines ? (
                <div
                  key={item.id}
                  className="rounded-xl border border-gold-hover bg-gold/5 px-3.5 py-3.25"
                >
                  <div className="flex items-center gap-2.5">
                    <Image
                      src={wordmarkFor(item)}
                      alt={item.name}
                      height={14}
                      width={90}
                      style={{ height: 14, width: "auto" }}
                    />
                    <span className="text-[11.8px] font-medium text-gold">
                      REItools+ · bundle pricing applied
                    </span>
                    <div className="ml-auto font-bold font-display text-sm whitespace-nowrap">
                      +{formatCents(item.priceCents)}/mo
                    </div>
                    <button
                      onClick={() => onRemove(item.id)}
                      className="text-gray hover:text-red text-base px-1"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-2.5 flex flex-col gap-1.5 pl-1 border-l border-gold-hover/40 ml-1">
                    {item.lines.map((line) => (
                      <div
                        key={line.featureSlug}
                        className="flex items-center justify-between pl-2.5 text-[12px]"
                      >
                        <span className="text-silver">{line.name}</span>
                        <span className="text-white font-medium whitespace-nowrap">
                          {formatCents(line.priceCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-border-default bg-black px-3.5 py-3.25"
                >
                  <div className="flex items-center gap-2">
                    <Image
                      src={wordmarkFor(item)}
                      alt={item.name}
                      height={14}
                      width={90}
                      style={{ height: 14, width: "auto" }}
                    />
                    <span className="text-[11.8px] text-silver">
                      {KIND_LABEL[item.kind]}
                    </span>
                  </div>
                  <div className="ml-auto font-bold font-display text-sm whitespace-nowrap">
                    {item.kind === "sub"
                      ? `+${formatCents(item.priceCents)}/mo`
                      : formatCents(item.priceCents)}
                  </div>
                  <button
                    onClick={() => onRemove(item.id)}
                    className="text-gray hover:text-red text-base px-1"
                  >
                    ×
                  </button>
                </div>
              ),
            )
          )}

          {nudge && (
            <button
              onClick={() => setNudgeOpen(true)}
              className="text-left rounded-xl border border-gold-hover bg-gold/10 px-3.75 py-3.25 hover:bg-gold/15 transition-colors"
            >
              <div className="flex items-center gap-2 font-semibold text-sm text-gold">
                {nudge.type === "A" ? "Complete the bundle" : "Upgrade to Pro"}
              </div>
              <p className="text-[12.4px] mt-1 leading-relaxed text-silver">
                One more line gets you into <b className="text-white">{nudge.bundle.name}</b> — see the details.
              </p>
            </button>
          )}
        </div>

        {cart.length > 0 && (
          <div className="border-t border-border-default px-5.5 py-4.5">
            <div className="flex justify-between text-sm text-silver mb-1">
              <span>Monthly</span>
              <span>+{formatCents(monthlyCents)}/mo</span>
            </div>
            <div className="flex justify-between text-sm text-silver mb-2">
              <span>One-time</span>
              <span>{formatCents(oneTimeCents)}</span>
            </div>
            <div className="flex justify-between font-semibold text-base font-display mb-3.5">
              <span>Due today</span>
              <span>{formatCents(monthlyCents + oneTimeCents)}</span>
            </div>
            <p className="text-[11.5px] text-gray mb-3">
              Recurring items are billed on top of your {membershipName}{" "}
              membership.
            </p>
            {checkoutError && (
              <p className="text-[11.5px] text-red mb-2">{checkoutError}</p>
            )}
            <Button
              variant="gold"
              size="sm"
              className="w-full"
              disabled={!allItemsCheckoutEligible || checkoutLoading}
              onClick={handleCheckout}
            >
              {checkoutLoading ? "Starting checkout…" : "Checkout"}
            </Button>
          </div>
        )}
      </Drawer>

      {clientSecret && (
        <CheckoutForm
          publishableKey={stripePublishableKey}
          clientSecret={clientSecret}
          onClose={() => setClientSecret(null)}
        />
      )}

      <BundleNudgeModal
        nudge={nudgeOpen ? nudge : null}
        tools={tools}
        onClose={() => setNudgeOpen(false)}
        onApplySwap={onApplySwap}
      />
    </>
  );
}
