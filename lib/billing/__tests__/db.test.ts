import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { marker: "the-shared-app-client" } }));

import { getBillingDb } from "../db";

const ENV_KEYS = ["PIPELINE_DATABASE_URL", "BILLING_DB_TARGET", "NODE_ENV", "DATABASE_URL", "SEED_DATABASE_URL"] as const;

describe("getBillingDb", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete (process.env as any)[k]; else (process.env as any)[k] = saved[k]; }
  });

  it("refuses a production host in PIPELINE_DATABASE_URL — unchanged from before BILLING_DB_TARGET existed", async () => {
    process.env.PIPELINE_DATABASE_URL = "postgresql://u:p@ep-restless-silence-123.us-east-1.aws.neon.tech/db";
    await expect(getBillingDb()).rejects.toThrow(/production host/);
  });

  it("BILLING_DB_TARGET set to something other than 'prod' throws immediately", async () => {
    process.env.BILLING_DB_TARGET = "staging";
    await expect(getBillingDb()).rejects.toThrow(/must be unset or "prod"/);
  });

  it("BILLING_DB_TARGET=prod but PIPELINE_DATABASE_URL is set (preview) — mismatch, throws", async () => {
    process.env.BILLING_DB_TARGET = "prod";
    process.env.PIPELINE_DATABASE_URL = "postgresql://u:p@ep-proud-frog-aqcx8uvk.c-8.us-east-1.aws.neon.tech/db";
    await expect(getBillingDb()).rejects.toThrow(/mismatch/);
  });

  it("target unset, no PIPELINE_DATABASE_URL, resolved app URL is NOT production: unchanged — returns the shared client", async () => {
    delete process.env.PIPELINE_DATABASE_URL;
    delete process.env.BILLING_DB_TARGET;
    (process.env as any).NODE_ENV = "test";
    process.env.SEED_DATABASE_URL = "postgresql://u:p@ep-proud-frog-aqcx8uvk.c-8.us-east-1.aws.neon.tech/db";
    const db = await getBillingDb();
    expect(db).toMatchObject({ marker: "the-shared-app-client" });
  });

  it("NEW: target unset, no PIPELINE_DATABASE_URL, resolved app URL IS production — refuses (would previously have connected silently)", async () => {
    delete process.env.PIPELINE_DATABASE_URL;
    delete process.env.BILLING_DB_TARGET;
    (process.env as any).NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://u:p@ep-restless-silence-123.us-east-1.aws.neon.tech/db";
    await expect(getBillingDb()).rejects.toThrow(/production host/);
  });

  it("NEW: BILLING_DB_TARGET=prod, no PIPELINE_DATABASE_URL, resolved app URL IS production — allowed", async () => {
    delete process.env.PIPELINE_DATABASE_URL;
    process.env.BILLING_DB_TARGET = "prod";
    (process.env as any).NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://u:p@ep-restless-silence-123.us-east-1.aws.neon.tech/db";
    const db = await getBillingDb();
    expect(db).toMatchObject({ marker: "the-shared-app-client" });
  });

  it("NEW: BILLING_DB_TARGET=prod but the resolved app URL is NOT production — mismatch, throws", async () => {
    delete process.env.PIPELINE_DATABASE_URL;
    process.env.BILLING_DB_TARGET = "prod";
    (process.env as any).NODE_ENV = "test";
    process.env.SEED_DATABASE_URL = "postgresql://u:p@ep-proud-frog-aqcx8uvk.c-8.us-east-1.aws.neon.tech/db";
    await expect(getBillingDb()).rejects.toThrow(/mismatch/);
  });
});

describe("dbHost", () => {
  it("returns the host only — never user, password, path or query — preferring PIPELINE_DATABASE_URL", async () => {
    const { dbHost } = await import("../db");
    const env = { NODE_ENV: "production", DATABASE_URL: "postgresql://user:secret@ep-restless-silence-1.neon.tech/db?sslmode=require" };
    expect(dbHost(env)).toBe("ep-restless-silence-1.neon.tech");
    expect(dbHost({ ...env, PIPELINE_DATABASE_URL: "postgresql://a:b@pipe.neon.tech:5432/x" })).toBe("pipe.neon.tech:5432");
    expect(dbHost({})).toBe("unknown");
    expect(dbHost({ NODE_ENV: "production", DATABASE_URL: "not a url secret" })).toBe("unknown");
  });
});
