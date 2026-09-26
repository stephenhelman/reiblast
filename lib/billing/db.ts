import { PrismaClient } from "@prisma/client";

const PROD_HOST = "ep-restless-silence";
const g = globalThis as unknown as { billingPipelinePrisma?: PrismaClient };

/**
 * DB client for the billing pipeline only (payment-event route + ingestTransaction default).
 *
 * If PIPELINE_DATABASE_URL is set (Vercel Preview scope for the pipeline-refactor branch), billing reads/writes
 * go to that database — never the production host (fails closed). If it is unset (production), this is exactly
 * the app's shared client from lib/prisma, so production behavior is unchanged.
 */
export async function getBillingDb(): Promise<PrismaClient> {
  const url = process.env.PIPELINE_DATABASE_URL;
  if (!url) return (await import("@/lib/prisma")).prisma;
  if (url.includes(PROD_HOST)) throw new Error("PIPELINE_DATABASE_URL points at the production host — refusing.");
  return (g.billingPipelinePrisma ??= new PrismaClient({ datasourceUrl: url, log: ["error"] }));
}
