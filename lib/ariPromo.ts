// Ari-special promo codes → trial tier → GHL form.
//
// ARI_PROMO_CODES is a server-only comma list of CODE:DAYS pairs, e.g.
//   ARI_PROMO_CODES=ARI14:14,ARI30:30
// Each tier's GHL form URL comes from env, so adding a tier is one new
// entry in TIERS plus one env var.

export interface AriTier {
  days: number;
  formUrl: string;
  formName: string;
}

const TIERS: Record<number, { env: string; formName: string }> = {
  14: { env: "NEXT_PUBLIC_ARI_CHECKOUT_LINK", formName: "14 Day Trial" },
  30: { env: "ARI_CHECKOUT_LINK_30", formName: "30 Day Trial" },
};

function parseCodes(): Map<string, number> {
  const map = new Map<string, number>();
  for (const pair of (process.env.ARI_PROMO_CODES ?? "").split(",")) {
    const [code, days] = pair.split(":").map((s) => s.trim());
    if (code && Number(days)) map.set(code.toUpperCase(), Number(days));
  }
  return map;
}

/** Resolve a user-entered code to its tier, or null if invalid/unconfigured. */
export function resolveAriPromo(input: string | undefined | null): AriTier | null {
  const code = input?.trim().toUpperCase();
  if (!code) return null;
  const days = parseCodes().get(code);
  const tier = days ? TIERS[days] : undefined;
  const formUrl = tier && process.env[tier.env];
  if (!days || !tier || !formUrl) return null;
  return { days, formUrl, formName: tier.formName };
}
