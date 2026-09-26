/** Shared CLI plumbing for the nightly jobs: dry-run by default, --apply to write, refuses the production host. */
import dotenv from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// GHL keys live in .env.local. dotenv never overrides vars already set, so a DATABASE_URL exported by the caller wins.
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

const PROD_HOST = "ep-restless-silence";

export function connect(): { db: PrismaClient; host: string; apply: boolean } {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (url.includes(PROD_HOST)) throw new Error("Refusing to run against the production host.");
  const host = new URL(url).host;
  const apply = process.argv.includes("--apply");
  console.log(`Host: ${host}`);
  console.log(`Mode: ${apply ? "APPLY (writing)" : "dry-run"}\n`);
  return { db: new PrismaClient({ datasources: { db: { url } } }), host, apply };
}

export const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
