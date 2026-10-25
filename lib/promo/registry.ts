import type { PromoPostDb } from "./post";

export interface PromoCtx {
  now: Date;
  dryRun: boolean;
  db: PromoPostDb;
}
/** Returns the response body; `reason` is required and must be a fixed code (no URLs, secrets or PII). */
export type PromoHandler = (ctx: PromoCtx) => Promise<{ reason: string; [k: string]: unknown }>;

/** promo -> event -> handler. A later promo event (claim_processed, invoice_paid, intake_submitted) is one entry here. */
export type PromoRegistry = Record<string, Record<string, PromoHandler>>;
