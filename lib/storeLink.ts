// Centralized /store URL contract. The launcher writes these links; the store
// parses them on load. Writer and parser stay in this one file so both sides
// can never drift apart.

export type StoreIntent = "credits" | "upgrade" | "addon" | "product" | "learn";

export interface StoreLinkParams {
  /** Where the visitor came from — a tool slug, an op-direct service slug, or "launcher". */
  from: string;
  intent: StoreIntent;
}

export function buildStoreLink({ from, intent }: StoreLinkParams): string {
  const params = new URLSearchParams({ from, intent });
  return `/store?${params.toString()}`;
}

export type StoreTab = "credits" | "tools" | "bundles" | "addons";

/**
 * Provisional tab per raw intent, used only as parseStoreLink's fallback
 * before resolveArrival() has real tool/tier state to work with. "upgrade"
 * defaults to Tools because that's its usual outcome (a higher tier exists);
 * resolveArrival is what actually decides — see below.
 */
export const INTENT_TAB: Record<StoreIntent, StoreTab> = {
  credits: "credits",
  upgrade: "tools",
  addon: "tools",
  product: "addons",
  learn: "tools",
};

export interface ParsedStoreLink {
  from: string | null;
  intent: StoreIntent | null;
  tab: StoreTab;
}

const VALID_INTENTS: StoreIntent[] = ["credits", "upgrade", "addon", "product", "learn"];

/** Reads ?from=&intent= off a URLSearchParams (client or server) into the raw arrival contract — no member/tier state yet, see resolveArrival(). */
export function parseStoreLink(searchParams: URLSearchParams | Record<string, string | string[] | undefined>): ParsedStoreLink {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) return searchParams.get(key);
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  };

  const from = get("from");
  const rawIntent = get("intent");
  const intent = VALID_INTENTS.includes(rawIntent as StoreIntent) ? (rawIntent as StoreIntent) : null;

  return {
    from,
    intent,
    tab: intent ? INTENT_TAB[intent] : "credits",
  };
}

/** The slice of store tool state resolveArrival needs — satisfied structurally by types/store.ts's StoreTool. */
export interface ArrivalTool {
  slug: string;
  active: boolean;
  meteringShape: "per_cycle" | "by_volume" | "none";
  /** lib/entitlement.ts#hasHigherTier, precomputed server-side onto the tool. */
  hasHigherTier: boolean;
}

export interface ResolvedArrival {
  tab: StoreTab;
  /** Tools tab: which tool's learn-more modal to auto-open on load. Null = open nothing. */
  openToolSlug: string | null;
  /** Credits tab: which translator chip to pre-select. Null = default chip. */
  creditsToolSlug: string | null;
  /**
   * Set only when landing on Credits is the upgrade->credits FALLBACK (they
   * asked to upgrade, that tool has no higher tier) — never for a plain
   * intent=credits arrival, which didn't ask to upgrade and has nothing to
   * explain. Lets the Credits tab show an affirming "you're on the top tier"
   * message instead of silently landing there. Naturally stops firing for a
   * given tool the moment hasHigherTier flips true for it (a later tier-
   * headroom feature raising the ceiling) — no logic change needed then.
   */
  upgradeMaxedToolSlug: string | null;
}

/**
 * Resolves ?from=&intent= against the already-fetched store catalog — pure,
 * no I/O (hasHigherTier is precomputed onto each ArrivalTool server-side).
 * The contract:
 *   learn    -> Tools tab, open from's modal. Roadmap rule: this fires even
 *               for a coming-soon tool (informational — shows tiers + state);
 *               modal-open keys on `from` matching a real tool, not on active.
 *   credits  -> Credits tab, pre-select from's chip IF active+metered.
 *   upgrade  -> "move to a higher TIER", never a bundle (a bundle only lowers
 *               price at the same allowance). hasHigherTier true -> behaves
 *               like learn (open the modal on the higher tier). False -> no
 *               higher tier to offer, falls back to credits.
 *   missing/invalid `from` -> land on the tab, open nothing.
 */
export function resolveArrival(parsed: ParsedStoreLink, tools: ArrivalTool[]): ResolvedArrival {
  const tool = parsed.from ? tools.find((t) => t.slug === parsed.from) : undefined;
  if (!tool) return { tab: parsed.tab, openToolSlug: null, creditsToolSlug: null, upgradeMaxedToolSlug: null };

  const creditsEligible = tool.active && tool.meteringShape !== "none";

  switch (parsed.intent) {
    case "learn":
      return { tab: "tools", openToolSlug: tool.slug, creditsToolSlug: null, upgradeMaxedToolSlug: null };
    case "upgrade":
      if (tool.hasHigherTier) {
        return { tab: "tools", openToolSlug: tool.slug, creditsToolSlug: null, upgradeMaxedToolSlug: null };
      }
      return {
        tab: "credits",
        openToolSlug: null,
        creditsToolSlug: creditsEligible ? tool.slug : null,
        upgradeMaxedToolSlug: tool.slug,
      };
    case "credits":
      return { tab: "credits", openToolSlug: null, creditsToolSlug: creditsEligible ? tool.slug : null, upgradeMaxedToolSlug: null };
    default:
      return { tab: parsed.tab, openToolSlug: null, creditsToolSlug: null, upgradeMaxedToolSlug: null };
  }
}
