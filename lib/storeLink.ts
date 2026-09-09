// Centralized /store URL contract. The launcher builds these links; the store
// reads the same `from`/`intent` params — keep both sides pointed at this file.

export type StoreIntent = "credits" | "upgrade" | "learn";

export interface StoreLinkParams {
  /** Where the visitor came from — a tool slug, an op-direct service slug, or "launcher". */
  from: string;
  intent: StoreIntent;
}

export function buildStoreLink({ from, intent }: StoreLinkParams): string {
  const params = new URLSearchParams({ from, intent });
  return `/store?${params.toString()}`;
}
