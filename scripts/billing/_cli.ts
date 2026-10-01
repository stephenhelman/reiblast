/** Shared CLI plumbing for the nightly jobs and admin scripts: dry-run by default, --apply to write, refuses the
 *  production host unless production mode is explicitly and interactively confirmed (docs/cutover.md A1). */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// GHL keys live in .env.local. dotenv never overrides vars already set, so a DATABASE_URL exported by the caller wins.
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

export const PROD_HOST = "ep-restless-silence";

export type GuardResult = { host: string; database: string; isProdHost: boolean; target: "prod" | undefined };

/**
 * Production mode requires ALL of: BILLING_DB_TARGET=prod, --i-mean-production, and typing the resolved host name
 * back at an interactive prompt (refuses when stdin is not a TTY — there is no --yes bypass). Absent all of that on
 * a production host, this throws exactly as it always has. A mismatch either way (prod target with a non-prod host,
 * or the reverse) also throws.
 *
 * Pure aside from the injectable `ask`, so the whole combination matrix is testable without touching real stdin.
 */
export async function assertProductionGuard(opts: {
  url: string;
  env?: Record<string, string | undefined>;
  argv?: string[];
  isTTY?: boolean;
  ask?: (question: string) => Promise<string>;
}): Promise<GuardResult> {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;
  const isTTY = opts.isTTY ?? !!process.stdin.isTTY;

  const parsed = new URL(opts.url);
  const host = parsed.host;
  const database = parsed.pathname.replace(/^\//, "");
  const isProdHost = opts.url.includes(PROD_HOST);

  const rawTarget = env.BILLING_DB_TARGET;
  if (rawTarget !== undefined && rawTarget !== "prod") throw new Error(`BILLING_DB_TARGET must be unset or "prod" (got "${rawTarget}").`);
  const target = rawTarget as "prod" | undefined;
  const hasFlag = argv.includes("--i-mean-production");

  if (isProdHost) {
    if (target !== "prod" || !hasFlag) {
      throw new Error(`Refusing to run against the production host (${host}): requires BILLING_DB_TARGET=prod, --i-mean-production, and a typed host confirmation.`);
    }
    if (!isTTY) throw new Error(`Refusing to run against production (${host}): stdin is not a TTY, so the typed confirmation can't be collected — run interactively.`);
    const ask = opts.ask ?? defaultAsk;
    const answer = (await ask(`\n!! PRODUCTION DATABASE !!\nHost: ${host}\nDatabase: ${database}\nType the host name to confirm: `)).trim();
    if (answer !== host) throw new Error(`Typed confirmation "${answer}" did not match the host name "${host}" — refusing.`);
  } else if (target === "prod") {
    throw new Error(`BILLING_DB_TARGET=prod but the resolved host (${host}) is not the production host — refusing (mismatch).`);
  }

  return { host, database, isProdHost, target };
}

async function defaultAsk(question: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function connect(): Promise<{ db: PrismaClient; host: string; apply: boolean }> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  const { host, target } = await assertProductionGuard({ url });
  const apply = process.argv.includes("--apply");
  console.log(`Host: ${host}`);
  console.log(`Target: ${target === "prod" ? "PRODUCTION (confirmed)" : "non-production"}`);
  console.log(`Mode: ${apply ? "APPLY (writing)" : "dry-run"}\n`);
  return { db: new PrismaClient({ datasources: { db: { url } } }), host, apply };
}

export const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
