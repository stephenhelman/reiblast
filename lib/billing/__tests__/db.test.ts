import { afterEach, describe, expect, it } from "vitest";
import { getBillingDb } from "../db";

describe("getBillingDb", () => {
  const prev = process.env.PIPELINE_DATABASE_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = prev;
  });

  it("refuses a production host in PIPELINE_DATABASE_URL", async () => {
    process.env.PIPELINE_DATABASE_URL = "postgresql://u:p@ep-restless-silence-123.us-east-1.aws.neon.tech/db";
    await expect(getBillingDb()).rejects.toThrow(/production host/);
  });
});
