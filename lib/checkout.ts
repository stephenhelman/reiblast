// mintCheckout — the one embedded-checkout-session primitive (2026-09-12
// checkout-architecture appendix). Engine-pure: takes userId as a parameter
// and does NOT read the session cookie itself, so a future OTP-authed
// Cart-claim caller can reuse it unchanged. The caller (app/tools/store's
// server action today) resolves auth and passes userId in.
//
// Single-mode-cart rule: a cart is either all-subscription (Tier/Bundle) or
// all-one-time (CreditPack), never mixed — buying a pack and a subscription
// together is a non-flow by product design. Mixed input is rejected, not
// split into two sessions.

import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

type CheckoutMode = "subscription" | "payment";

interface ResolvedPrice {
  priceId: string;
  mode: CheckoutMode;
  tierId?: string;
  bundleId?: string;
  creditPackId?: string;
}

async function resolvePrice(priceId: string): Promise<ResolvedPrice> {
  const [tier, bundle, pack] = await Promise.all([
    prisma.tier.findUnique({ where: { stripePriceId: priceId } }),
    prisma.bundle.findUnique({ where: { stripePriceId: priceId } }),
    prisma.creditPack.findUnique({ where: { stripePriceId: priceId } }),
  ]);

  if (tier) return { priceId, mode: "subscription", tierId: tier.id };
  if (bundle) return { priceId, mode: "subscription", bundleId: bundle.id };
  if (pack) return { priceId, mode: "payment", creditPackId: pack.id };

  throw new Error(`mintCheckout: priceId "${priceId}" does not resolve to any Tier, Bundle, or CreditPack row`);
}

/**
 * Preflight against Stripe itself — catches a Price created in the wrong
 * mode (e.g. a subscription Tier's Price accidentally made one-time) before
 * the session-create call fails opaquely. Flags the mismatch by name rather
 * than letting Stripe's own rejection speak for it.
 */
async function assertPriceModeMatches(priceId: string, expected: CheckoutMode): Promise<void> {
  const price = await stripe.prices.retrieve(priceId);
  const actual: CheckoutMode = price.type === "recurring" ? "subscription" : "payment";
  if (actual !== expected) {
    throw new Error(
      `mintCheckout: Stripe Price ${priceId} is ${price.type} but the owning catalog row expects ${expected} mode — fix the Price in Stripe, don't work around it here.`,
    );
  }
}

export async function mintCheckout(userId: string, priceIds: string[]): Promise<{ clientSecret: string }> {
  if (priceIds.length === 0) throw new Error("mintCheckout: priceIds must not be empty");

  const resolved = await Promise.all(priceIds.map(resolvePrice));

  const mode = resolved[0].mode;
  if (!resolved.every((row) => row.mode === mode)) {
    throw new Error(
      `mintCheckout: mixed-mode cart rejected — a cart is either all-subscription or all-one-time, never mixed (${resolved
        .map((row) => `${row.priceId}:${row.mode}`)
        .join(", ")})`,
    );
  }

  const bundleIds = resolved.flatMap((row) => (row.bundleId ? [row.bundleId] : []));
  if (bundleIds.length > 1) {
    throw new Error("mintCheckout: more than one bundle in a single cart is not supported — pass a single bundleId");
  }

  await Promise.all(resolved.map((row) => assertPriceModeMatches(row.priceId, mode)));

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId },
    });
    customerId = customer.id;
    // Write-back is what makes Chat B's subscription lifecycle events
    // (renewal/cancellation/past_due, keyed off the Stripe customer)
    // resolvable to a userId later — do not skip it.
    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
  }

  const tierIds = resolved.flatMap((row) => (row.tierId ? [row.tierId] : []));
  const creditPackIds = resolved.flatMap((row) => (row.creditPackId ? [row.creditPackId] : []));

  const metadata: Record<string, string> = { userId };
  if (tierIds.length > 0) metadata.tierIds = tierIds.join(",");
  if (bundleIds.length === 1) metadata.bundleId = bundleIds[0];
  if (creditPackIds.length > 0) metadata.creditPackIds = creditPackIds.join(",");

  // /tools/store is served under the tools host (see middleware.ts), not the
  // marketing host — return_url and the branding logo URL must both resolve
  // there, or Stripe redirects/fetches against the wrong domain.
  const toolsUrl = process.env.NEXT_PUBLIC_TOOLS_URL;
  if (!toolsUrl) throw new Error("mintCheckout: NEXT_PUBLIC_TOOLS_URL is not set (needed for return_url)");

  const session = await stripe.checkout.sessions.create({
    mode,
    ui_mode: "embedded_page",
    line_items: priceIds.map((priceId) => ({ price: priceId, quantity: 1 })),
    client_reference_id: userId,
    customer: customerId,
    metadata,
    redirect_on_completion: "if_required",
    return_url: `${toolsUrl}/tools/store?checkout=complete`,
    // REItools branding for this OP Web Studio-run Stripe account — per-request,
    // not the Stripe Dashboard default, since REItools is one brand among
    // others this Stripe account may serve. branding_settings is the only
    // customization surface for ui_mode: 'embedded_page' (the full `appearance`
    // API is elements-only, a different integration). NOTE: `logo` is rejected
    // by the live API for ui_mode: 'embedded_page' despite the SDK's types
    // allowing it (confirmed against a real Stripe error, not just docs) —
    // color/border/font/name only for this ui_mode.
    branding_settings: {
      background_color: "#0A0A0A",
      button_color: "#F5C842",
      border_style: "rounded",
      display_name: "REI/tools",
      font_family: "inter",
    },
    ...(mode === "subscription" ? { subscription_data: { metadata: { userId } } } : {}),
  });

  if (!session.client_secret) throw new Error("mintCheckout: Stripe did not return a client_secret");

  return { clientSecret: session.client_secret };
}
