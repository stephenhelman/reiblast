import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SUPPORT_EMAIL } from "@/lib/constants";

/**
 * US-only gating for the paid funnel.
 *
 * KNOWN LIMITATION: this is IP geolocation. It stops casual non-US traffic, not
 * a US VPN or a proxied connection — anyone with a US exit node reads as US here.
 * That is accepted: the real backstop is downstream, at the a2pPhone / A2P
 * provisioning step, which requires a genuine US business identity (EIN, US
 * address, US phone) before any sub-account can send SMS. This middleware gate is
 * the cheap first filter, not the compliance control.
 */

/**
 * Countries allowed into the funnel.
 *
 * NOTE: US territories report their own ISO codes via Vercel geo (PR, VI, GU, AS,
 * MP) and are therefore blocked by this list even though they sit inside US
 * jurisdiction and the +1 numbering plan. If Puerto Rico et al. should be able to
 * buy, add those codes here — nothing else needs to change.
 */
export const ALLOWED_COUNTRIES = ["US"] as const;

/**
 * Route prefixes that are US-gated: the checkout and onboarding entry points only.
 *
 * Everything else on the marketing site (pricing, features, FAQ, legal, contact,
 * /login for existing members who may be travelling) stays globally viewable.
 * Paths are the PUBLIC paths, i.e. what the visitor types — matched before
 * middleware rewrites them under /marketing.
 */
export const GATED_PREFIXES = [
  "/checkout", // primary checkout page + embedded order form
  "/ari-special", // promo-gated checkout (30-day trial form)
  "/signup", // funnel entry, links straight to the payment link
  "/onboarding", // covers /onboarding and /onboarding/success
  "/onboarding-complete", // post-submit confirmation, same funnel
] as const;

/** Where blocked visitors land. Must never itself be gated (redirect loop). */
export const REGION_UNAVAILABLE_PATH = "/region-unavailable";

/** Editable without a code change; falls back to the standard support inbox. */
export const REGION_CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_REGION_CONTACT_EMAIL || SUPPORT_EMAIL;

export function isGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Resolve the request country.
 *
 * `request.geo` is Next 14's native accessor; on Vercel the platform injects it
 * into the middleware invocation. It is undefined off-Vercel (local dev, any
 * self-hosted runtime), so we fall back to the same header Vercel derives it
 * from, which makes the gate simulatable locally.
 *
 * The fallback cannot weaken production: on Vercel, inbound `x-vercel-ip-*`
 * headers are overwritten by the platform, so a client cannot spoof them — and
 * where geo is genuinely absent the policy is allow-through anyway, so a forged
 * header can only block the forger, never unblock a blocked visitor.
 *
 * Returns undefined when the country is genuinely unknown.
 */
export function getCountry(request: NextRequest): string | undefined {
  const fromGeo = request.geo?.country;
  if (fromGeo) return fromGeo;

  const fromHeader = request.headers.get("x-vercel-ip-country");
  return fromHeader || undefined;
}

/**
 * Policy decision for a resolved country.
 *
 * DECISION — allow on unknown. A missing country is treated as allowed rather
 * than blocked, deliberately:
 *   - local dev and preview builds have no geo at all and must stay usable;
 *   - in production an absent geo header means an odd network path (corporate
 *     egress, privacy relay, a Vercel edge miss), not a foreign visitor. Blocking
 *     it would turn an infrastructure hiccup into a lost US sale.
 * The cost of a false allow is one non-US visitor reaching a form they cannot
 * complete anyway (A2P will reject them); the cost of a false block is a paying
 * US customer hitting a wall. Asymmetric, so we allow.
 */
export function isCountryAllowed(country: string | undefined): boolean {
  if (!country) return true; // unknown → allow, see above
  return (ALLOWED_COUNTRIES as readonly string[]).includes(country);
}

/**
 * Region guard for API route handlers.
 *
 * The middleware gate only covers page routes — `config.matcher` excludes /api,
 * and it must, because the middleware rewrites every matched path under
 * /marketing or /tools. So the endpoints behind the checkout and onboarding
 * forms would otherwise still accept direct requests from a blocked visitor,
 * bypassing the page gate entirely.
 *
 * Call at the top of a handler in the signup/onboarding/promo flow:
 *
 *   const blocked = guardRegion(req);
 *   if (blocked) return blocked;
 *
 * Returns a 403 JSON body — never a redirect; an HTML redirect is the wrong
 * response for a fetch() caller. Policy is identical to the page gate: the same
 * `getCountry` resolution (native `geo`, then the `x-vercel-ip-country` header,
 * which is what actually resolves here since route handlers run in the Node
 * runtime where Vercel does not populate `geo`) and the same allow-on-unknown
 * `isCountryAllowed` check, so the two gates can never disagree.
 *
 * Do NOT add this to webhook, OAuth-callback, member-auth, or member-tool
 * routes: those are server-to-server or serve existing customers who may be
 * travelling, and geo-blocking them would break provisioning and logins.
 */
export function guardRegion(request: NextRequest): NextResponse | null {
  if (isCountryAllowed(getCountry(request))) return null;
  return NextResponse.json({ error: "region" }, { status: 403 });
}
