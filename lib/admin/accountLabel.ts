/**
 * How every admin view names a location/account. Pure.
 *   HQ → "REIblast HQ";  scope "_agency" → "Agency (GHL wallet)";  scope "_unattributed" → "Unattributed";
 *   otherwise GhlAccount.locationName → else User.businessName → else "Unnamed location".
 * `suffix` is the last 4 of the locationId (rendered muted) so two members with the same name stay distinguishable.
 */
export const HQ_LABEL = "REIblast HQ";
export const AGENCY_LABEL = "Agency (GHL wallet)";
export const UNATTRIBUTED_LABEL = "Unattributed";
export const UNNAMED_LABEL = "Unnamed location";

export type LabelInput = {
  /** A real GHL location id, or a wallet scopeKey (which may be "_agency" / "_unattributed"). */
  locationId?: string | null;
  scopeKey?: string | null;
  locationName?: string | null;
  businessName?: string | null;
};

export type AccountLabel = { name: string; suffix: string | null };

const usable = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" || t === "-" ? null : t;
};

export function accountLabel(input: LabelInput, hqLocationId: string | null | undefined = process.env.GHL_HQ_LOCATION_ID): AccountLabel {
  const id = input.locationId ?? input.scopeKey ?? null;
  if (id === "_agency") return { name: AGENCY_LABEL, suffix: null };
  if (id === "_unattributed") return { name: UNATTRIBUTED_LABEL, suffix: null };
  const suffix = id ? `…${id.slice(-4)}` : null;
  if (id && hqLocationId && id === hqLocationId) return { name: HQ_LABEL, suffix };
  return { name: usable(input.locationName) ?? usable(input.businessName) ?? UNNAMED_LABEL, suffix };
}

/** Plain-text form for exports/tooltips: "Name …abcd". */
export const formatAccountLabel = (l: AccountLabel): string => (l.suffix ? `${l.name} ${l.suffix}` : l.name);
