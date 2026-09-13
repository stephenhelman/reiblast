"use client";

import { useState } from "react";
import Image from "next/image";
import Drawer from "@/components/shared/Drawer";
import Button from "@/components/shared/Button";
import { formatCents } from "@/lib/money";
import { smartCartSuggestion } from "@/lib/storeCart";
import { startCheckoutAction } from "@/app/tools/store/actions";
import CheckoutForm from "./CheckoutForm";
import { getBrandAssets, portalBrand, creditsBrand } from "@/lib/brandAssets";
import { brandSlugFor } from "@/lib/brandSlug";
import type { StoreBundle } from "@/types/store";
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
  membershipName,
  onRemove,
  onApplySwap,
  stripePublishableKey,
}: CartDrawerProps) {
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const priceIds = cart.map((item) => item.stripePriceId);
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

  const smartCartCandidates = cart.filter(
    (item): item is CartItem & { featureSlug: string } =>
      !!item.featureSlug && !item.bundleSlug,
  );
  const suggestedBundle = smartCartSuggestion(
    smartCartCandidates.map((item) => ({
      featureSlug: item.featureSlug,
      priceCents: item.priceCents,
    })),
    bundles,
  );
  const soloSumCents = suggestedBundle
    ? smartCartCandidates.reduce((sum, item) => sum + item.priceCents, 0)
    : 0;
  const savingsCents = suggestedBundle
    ? soloSumCents - suggestedBundle.priceCents
    : 0;

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
            cart.map((item) => (
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
            ))
          )}

          {suggestedBundle && savingsCents > 0 && (
            <div className="rounded-xl border border-gold-hover bg-gold/10 px-3.75 py-3.5">
              <div className="flex items-center gap-2 font-semibold text-sm text-gold">
                Smart cart
              </div>
              <p className="text-[12.4px] mt-1.5 leading-relaxed">
                The <b className="text-white">{suggestedBundle.name}</b> bundle
                covers what you've added for less than buying it piece by piece.
              </p>
              <Button
                variant="gold"
                size="sm"
                className="w-full mt-2.5"
                onClick={() => onApplySwap(suggestedBundle)}
              >
                Swap to {suggestedBundle.name} · save{" "}
                {formatCents(savingsCents)}/mo
              </Button>
            </div>
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
    </>
  );
}
