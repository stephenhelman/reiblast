import { describe, expect, it } from "vitest";
import { assertProductionGuard } from "@/scripts/billing/_cli";

const PROD_URL = "postgresql://u:p@ep-restless-silence-123.us-east-1.aws.neon.tech/db";
const NONPROD_URL = "postgresql://u:p@ep-proud-frog-aqcx8uvk.c-8.us-east-1.aws.neon.tech/db";
const ASK_OK = async (q: string) => "ep-restless-silence-123.us-east-1.aws.neon.tech"; // the host assertProductionGuard would compute

describe("assertProductionGuard (scripts/billing/_cli.ts) — the full combination matrix", () => {
  it("non-prod host, target unset, no flag: allowed, unchanged from before this gate existed", async () => {
    const r = await assertProductionGuard({ url: NONPROD_URL, env: {}, argv: [] });
    expect(r).toMatchObject({ isProdHost: false, target: undefined });
  });

  it("non-prod host, target unset, WITH the flag: allowed (the flag is meaningless off a prod host)", async () => {
    const r = await assertProductionGuard({ url: NONPROD_URL, env: {}, argv: ["--i-mean-production"] });
    expect(r.isProdHost).toBe(false);
  });

  it("BILLING_DB_TARGET set to something other than 'prod' throws immediately, any host", async () => {
    await expect(assertProductionGuard({ url: NONPROD_URL, env: { BILLING_DB_TARGET: "staging" }, argv: [] })).rejects.toThrow(/must be unset or "prod"/);
    await expect(assertProductionGuard({ url: PROD_URL, env: { BILLING_DB_TARGET: "staging" }, argv: [] })).rejects.toThrow(/must be unset or "prod"/);
  });

  it("mismatch: BILLING_DB_TARGET=prod but the host is NOT production — throws", async () => {
    await expect(assertProductionGuard({ url: NONPROD_URL, env: { BILLING_DB_TARGET: "prod" }, argv: ["--i-mean-production"] })).rejects.toThrow(/not the production host.*mismatch/);
  });

  it("prod host, target unset (missing target): refused, unchanged from the old blanket refusal", async () => {
    await expect(assertProductionGuard({ url: PROD_URL, env: {}, argv: ["--i-mean-production"], isTTY: true, ask: ASK_OK })).rejects.toThrow(/Refusing to run against the production host/);
  });

  it("prod host, target=prod, but the --i-mean-production flag is missing: refused", async () => {
    await expect(assertProductionGuard({ url: PROD_URL, env: { BILLING_DB_TARGET: "prod" }, argv: [], isTTY: true, ask: ASK_OK })).rejects.toThrow(/Refusing to run against the production host/);
  });

  it("prod host, target=prod, flag present, but stdin is not a TTY: refused, no ask() call, no --yes bypass exists", async () => {
    let asked = false;
    await expect(
      assertProductionGuard({ url: PROD_URL, env: { BILLING_DB_TARGET: "prod" }, argv: ["--i-mean-production", "--yes"], isTTY: false, ask: async () => { asked = true; return "whatever"; } }),
    ).rejects.toThrow(/stdin is not a TTY/);
    expect(asked).toBe(false);
  });

  it("prod host, target=prod, flag present, TTY, but the typed host doesn't match: refused", async () => {
    await expect(
      assertProductionGuard({ url: PROD_URL, env: { BILLING_DB_TARGET: "prod" }, argv: ["--i-mean-production"], isTTY: true, ask: async () => "wrong-host" }),
    ).rejects.toThrow(/did not match the host name/);
  });

  it("prod host, target=prod, flag present, TTY, typed host matches (even with surrounding whitespace): ALLOWED — the only passing combination", async () => {
    const r = await assertProductionGuard({ url: PROD_URL, env: { BILLING_DB_TARGET: "prod" }, argv: ["--i-mean-production"], isTTY: true, ask: async () => `  ${new URL(PROD_URL).host}  ` });
    expect(r).toMatchObject({ isProdHost: true, target: "prod", host: new URL(PROD_URL).host });
  });

  it("every one-of-three-missing combination on a prod host is refused (no partial credit)", async () => {
    const combos: [Record<string, string>, string[]][] = [
      [{}, ["--i-mean-production"]], // no target
      [{ BILLING_DB_TARGET: "prod" }, []], // no flag
    ];
    for (const [env, argv] of combos) {
      await expect(assertProductionGuard({ url: PROD_URL, env, argv, isTTY: true, ask: ASK_OK })).rejects.toThrow();
    }
  });
});
