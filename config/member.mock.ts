// PLACEHOLDER SEED DATA — dummy member for exercising launcher/store card states
// against config/catalog.ts. Not a real account, not a realistic Core member.
//
// The wallet correction (single shared creditBalance, not per-tool) has a real
// consequence here: on-credits/out-of-credits/locked all read the SAME wallet
// balance + hasEverBoughtCredits flag, so they're no longer independently
// controllable per tool the way they were under the old per-tool model. Only
// ONE of those three can be showing at a time across every not-otherwise-covered
// tool. This mock is set to `on-credits` (positive balance) for that shared
// state; the verify script exercises out-of-credits and locked via synthetic
// balance overrides instead of trying to force all three into one snapshot.
//
// State coverage (see lib/pricing.ts cardStatus for how these resolve):
//   in-plan        -> rei-score (core bundle allowance), rei-ask (solo "ask-sub"),
//                     rei-scrub (core bundle covers it with no allowance cap = unlimited,
//                     it just isn't credit-metered — NOT the same as tool.free)
//   on-credits     -> rei-pack, rei-dispo, rei-acq/"bots" (shared wallet balance > 0, not otherwise covered)
//   locked         -> rei-close (not free, not comingSoon, not credit-metered, not covered)
//   free           -> rei-site (tool.free flag, independent of member state)
//   coming-soon    -> rei-kit (tool.comingSoon flag, independent of member state)
//
// Note: under the single shared wallet, on-credits/out-of-credits/locked-via-wallet
// are mutually exclusive across every not-otherwise-covered tool at once (they all
// read the same balance + hasEverBoughtCredits flag). This mock is fixed at
// on-credits; the verify script demonstrates out-of-credits and locked via
// synthetic balance overrides rather than forcing all three into one snapshot.
//
// Read via lib/catalog.ts's getMember() — do not import this file directly from components.

import type { Member } from "@/types/catalog";

export const mockMember: Member = {
  id: "member-placeholder-1",
  name: "Placeholder Member",
  email: "placeholder@example.com",
  entitlements: {
    bundleSlug: "core",
    soloPlanIds: ["ask-sub"],
    // Single shared wallet — placeholder balance only, not a real ledger figure.
    creditBalance: 18,
    hasEverBoughtCredits: true,
    allowanceUsed: {
      "rei-score": 4,
      "rei-ask": 120,
    },
    opDirectServiceIds: ["op-direct-kit"],
  },
};
