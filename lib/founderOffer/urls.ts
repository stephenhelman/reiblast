// Kept separate from discordEvents so the preview script can use it without importing Prisma.
const DEFAULT_SITE = "https://reiblast.app";

/** Signup / claim links: explicit env wins, otherwise built off the existing NEXT_PUBLIC_APP_URL site URL. */
export function founderUrls() {
  const site = (process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_SITE).replace(/\/+$/, "");
  return {
    signup: process.env.FOUNDER_SIGNUP_URL?.trim() || `${site}/founders`,
    claim: process.env.FOUNDER_CLAIM_URL?.trim() || `${site}/founders/claim`,
  };
}

