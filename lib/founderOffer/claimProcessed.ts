import type { PromoHandler } from "@/lib/promo/registry";

/**
 * GHL → server, event "claim_processed", for the FREE WINNER only (no invoice): OP's workflow reports back the Studio contact it
 * created. Body (strings): { promo, event, claimToken, hqContactId, studioContactId }. Invoice data never arrives here; it comes from
 * /api/webhooks/op/invoice. Always answers with a reason, never an error status.
 */
const FIELDS = ["claimToken", "hqContactId", "studioContactId"] as const;

export const claimProcessed: PromoHandler = async (ctx) => {
  const v: Record<string, string | null> = {};
  for (const k of FIELDS) {
    const raw = ctx.body[k];
    const s = typeof raw === "string" ? raw.trim() : "";
    if (s.includes("{{")) return { reason: "unrendered_tag" };
    v[k] = s || null;
  }
  if (!v.claimToken || !v.hqContactId) return { reason: "bad_request" };
  if (!v.studioContactId) return { reason: "missing_studio_contact" };

  const claim = await ctx.claimDb.founderClaim.findUnique({ where: { token: v.claimToken }, select: { id: true, isFirst: true, studioContactId: true, ghlAccount: { select: { contactId: true } } } });
  if (!claim) return { reason: "claim_not_found" };
  if (claim.ghlAccount.contactId !== v.hqContactId) return { reason: "contact_mismatch" };
  if (!claim.isFirst) return { reason: "not_free_winner" };
  if (claim.studioContactId === v.studioContactId) return { reason: "already_processed" };
  if (claim.studioContactId) {
    console.error(`[claim_processed] studio_conflict claim=${claim.id}`);
    return { reason: "studio_conflict" };
  }
  if (ctx.dryRun) return { reason: "dry_run" };
  // Conditional write: a concurrent delivery that set it first leaves count 0 and this reports already_processed.
  const { count } = await ctx.claimDb.founderClaim.updateMany({ where: { id: claim.id, studioContactId: null }, data: { studioContactId: v.studioContactId } });
  return { reason: count === 1 ? "processed" : "already_processed" };
};
