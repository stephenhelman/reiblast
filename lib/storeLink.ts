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

/** Which tab each arrival intent opens. "learn" (locked-tool "Learn more") lands on Tools. */
export const INTENT_TAB: Record<StoreIntent, StoreTab> = {
  credits: "credits",
  upgrade: "bundles",
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

/** Reads ?from=&intent= off a URLSearchParams (client or server) into the arrival contract. */
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
