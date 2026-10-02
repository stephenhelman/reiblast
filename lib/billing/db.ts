import { PrismaClient } from "@prisma/client";

const PROD_HOST = "ep-restless-silence";
const g = globalThis as unknown as { billingPipelinePrisma?: PrismaClient };

/** BILLING_DB_TARGET: unset (default) or "prod" — anything else is a misconfiguration and throws immediately. */
export function billingDbTarget(env: Record<string, string | undefined> = process.env): "prod" | undefined {
  const t = env.BILLING_DB_TARGET;
  if (t === undefined || t === "prod") return t;
  throw new Error(`BILLING_DB_TARGET must be unset or "prod" (got "${t}").`);
}

/** Mirrors lib/prisma.ts's resolveDatasourceUrl exactly (keep in sync): production reads DATABASE_URL, everything else
 *  reads SEED_DATABASE_URL. Used only to detect the production host early — @/lib/prisma still does its own resolution
 *  (and its own "not set" error) when actually imported. */
function resolvedAppDbUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.NODE_ENV === "production" ? env.DATABASE_URL : env.SEED_DATABASE_URL;
}

/**
 * DB client for the billing pipeline (payment-event route + ingestTransaction default), gated by an explicit
 * BILLING_DB_TARGET (cutover.md A1 — "production access must be a deliberate, loud opt-in that replaces nothing
 * silently").
 *
 *   BILLING_DB_TARGET unset (default): unchanged from before this gate existed —
 *     - PIPELINE_DATABASE_URL set (Vercel Preview scope for pipeline-refactor) → that database.
 *     - PIPELINE_DATABASE_URL unset → the app's shared client (lib/prisma), whatever it resolves to.
 *   BILLING_DB_TARGET=prod: the resolved database must actually BE the production host, or this throws (mismatch).
 *   The reverse also throws: if what would be used resolves to the production host but BILLING_DB_TARGET is not
 *   "prod", this refuses rather than silently writing to production.
 */
export async function getBillingDb(): Promise<PrismaClient> {
  const target = billingDbTarget();

  const pipelineUrl = process.env.PIPELINE_DATABASE_URL;
  if (pipelineUrl) {
    if (pipelineUrl.includes(PROD_HOST)) throw new Error("PIPELINE_DATABASE_URL points at the production host — refusing.");
    if (target === "prod") throw new Error('BILLING_DB_TARGET=prod but PIPELINE_DATABASE_URL is set (a preview/pipeline database) — mismatch, refusing.');
    return (g.billingPipelinePrisma ??= new PrismaClient({ datasourceUrl: pipelineUrl, log: ["error"] }));
  }

  const resolvedUrl = resolvedAppDbUrl();
  const isProdHost = !!resolvedUrl && resolvedUrl.includes(PROD_HOST);
  if (isProdHost && target !== "prod") {
    throw new Error("The database this app would use resolves to the production host, but BILLING_DB_TARGET=prod was not set — refusing.");
  }
  if (!isProdHost && target === "prod") {
    throw new Error("BILLING_DB_TARGET=prod but the resolved database is not the production host — refusing (mismatch).");
  }
  return (await import("@/lib/prisma")).prisma;
}

/** Host (and port) of the database getBillingDb() would resolve, for diagnostics — never the user, password, path or query.
 *  Mirrors getBillingDb's URL selection without connecting or throwing; "unknown" if unset or unparseable. */
export function dbHost(env: Record<string, string | undefined> = process.env): string {
  const url = env.PIPELINE_DATABASE_URL || resolvedAppDbUrl(env);
  if (!url) return "unknown";
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
