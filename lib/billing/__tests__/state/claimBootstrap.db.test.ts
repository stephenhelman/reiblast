/**
 * claim() on an EMPTY JobRun table must create the row and succeed (regression: a bare UPDATE matched nothing, so every
 * trigger reported "in_flight" and the row was never created). Runs in one transaction against a TEMP TABLE named "JobRun"
 * that shadows the real one, always rolled back — no real data is read or written. Skips itself unless
 * REPORTS_TEST_DATABASE_URL is set; refuses the production host.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { claim } from "../../jobs/runner";

const URL = process.env.REPORTS_TEST_DATABASE_URL;
if (URL && URL.includes("ep-restless-silence")) throw new Error("REPORTS_TEST_DATABASE_URL points at the production host — refusing.");
const prisma = URL ? new PrismaClient({ datasourceUrl: URL }) : null;
afterAll(async () => void (await prisma?.$disconnect()));

class Rollback extends Error {}

async function inEmptyJobRun(fn: (tx: PrismaClient) => Promise<void>): Promise<void> {
  try {
    await (prisma as PrismaClient).$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE "JobRun" (LIKE public."JobRun" INCLUDING ALL) ON COMMIT DROP`);
      const check = await tx.$queryRawUnsafe<{ t: string | null }[]>(`SELECT to_regclass('pg_temp."JobRun"')::text AS t`);
      if (!check[0]?.t) throw new Error("temp table was not created — aborting");
      await fn(tx as unknown as PrismaClient);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

describe.skipIf(!URL)("claim() bootstrap on an empty JobRun table", () => {
  it("first claim creates the row and succeeds; an immediate second claim is in flight", async () => {
    await inEmptyJobRun(async (tx) => {
      expect(await claim(tx, "replay")).toBe(true);
      const rows = await tx.$queryRaw<{ job: string; lastStartAt: Date | null }[]>`SELECT "job", "lastStartAt" FROM "JobRun"`;
      expect(rows).toHaveLength(1);
      expect(rows[0].job).toBe("replay");
      expect(rows[0].lastStartAt).not.toBeNull();
      expect(await claim(tx, "replay")).toBe(false);
    });
  });
});
