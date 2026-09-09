// PLACEHOLDER SEED DATA — dummy member for exercising every launcher card state
// against config/catalog.ts. Not a real account.
//
// State coverage (see lib/pricing.ts cardStatus for how these resolve):
//   in-plan        -> rei-score (core bundle allowance, metered), rei-acq (solo plan, metered)
//   on-credits     -> rei-pack (positive credit balance, not covered by core)
//   out-of-credits -> rei-dispo (credit history exists, balance is 0)
//   locked         -> rei-ask, rei-close (no plan, no credits, no history)
//   free           -> rei-site (tool.free flag, independent of member state)
//   coming-soon    -> rei-kit (tool.comingSoon flag, independent of member state)
//
// Read via lib/catalog.ts's getMember() — do not import this file directly from components.

import type { Member } from "@/types/catalog";

export const mockMember: Member = {
  id: "member-placeholder-1",
  name: "Placeholder Member",
  email: "placeholder@example.com",
  entitlements: {
    bundleSlug: "core",
    soloPlanToolSlugs: ["rei-acq"],
    creditBalances: {
      "rei-pack": 15,
      "rei-dispo": 0,
    },
    toolsWithCreditHistory: ["rei-pack", "rei-dispo"],
    allowanceUsed: {
      "rei-score": 4,
      "rei-acq": 9,
    },
    opDirectServiceIds: ["op-direct-va-support"],
  },
};
