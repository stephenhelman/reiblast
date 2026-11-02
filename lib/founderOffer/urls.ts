// Kept separate from discordEvents so the preview script can use it without importing Prisma.
const DEFAULT_SITE = "https://reiblast.app";

/**
 * Signup / claim links: explicit env wins, otherwise built off the existing NEXT_PUBLIC_APP_URL site URL.
 *  - `claim` is the BASE of personal claim links (/api/discord/founder-link builds `${claim}?t=<token>`). Never use it for Discord copy.
 *  - `claimCta` is where the Discord promo copy sends members: the #founders-claim channel link (FOUNDER_CLAIM_CTA_URL), falling
 *    back to `claim` when unset.
 */
export function founderUrls() {
  const site = (process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_SITE).replace(/\/+$/, "");
  const claim = process.env.FOUNDER_CLAIM_URL?.trim() || `${site}/founders/claim`;
  return {
    signup: process.env.FOUNDER_SIGNUP_URL?.trim() || `${site}/founders`,
    claim,
    claimCta: process.env.FOUNDER_CLAIM_CTA_URL?.trim() || claim,
  };
}

