import type { PromoPostDb } from "./post";

/** The slice of Prisma the founder claim_processed handler uses (tests pass an in-memory stand-in). */
export interface PromoClaimDb {
  founderClaim: {
    findUnique(args: any): Promise<any>;
    updateMany(args: any): Promise<{ count: number }>;
  };
}

export interface PromoCtx {
  now: Date;
  dryRun: boolean;
  db: PromoPostDb;
  /** The parsed request body, for handlers that take fields (claim_processed). Tick/launch ignore it. */
  body: Record<string, unknown>;
  claimDb: PromoClaimDb;
}
/** Returns the response body; `reason` is required and must be a fixed code (no URLs, secrets or PII). */
export type PromoHandler = (ctx: PromoCtx) => Promise<{ reason: string; [k: string]: unknown }>;

/** promo -> event -> handler. A later promo event (claim_processed, invoice_paid, intake_submitted) is one entry here. */
export type PromoRegistry = Record<string, Record<string, PromoHandler>>;
