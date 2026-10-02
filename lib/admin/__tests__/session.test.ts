import { describe, expect, it } from "vitest";
import { AdminConfigError, getAdminSecret, signAdminSession, verifyAdminSession } from "../session";
import { TEST_ENV } from "./fakeDb";

const payload = { sub: "acct_owner", locationId: "LOC_HQ", method: "sms" as const };

describe("admin session secret fails closed", () => {
  it("missing", () => expect(() => getAdminSecret({})).toThrow(AdminConfigError));
  it("too short", () => expect(() => getAdminSecret({ ADMIN_SESSION_SECRET: "short" })).toThrow(/at least 32/));
  it("equal to TOOLS_SESSION_SECRET", () => {
    const s = "x".repeat(40);
    expect(() => getAdminSecret({ ADMIN_SESSION_SECRET: s, TOOLS_SESSION_SECRET: s })).toThrow(/must differ/);
  });
  it("valid when distinct", () => expect(getAdminSecret(TEST_ENV)).toBeInstanceOf(Uint8Array));

  it("signing throws and verifying returns null when misconfigured", async () => {
    const bad = { ADMIN_SESSION_SECRET: "x".repeat(40), TOOLS_SESSION_SECRET: "x".repeat(40) };
    await expect(signAdminSession(payload, bad)).rejects.toThrow(AdminConfigError);
    const token = await signAdminSession(payload, TEST_ENV);
    expect(await verifyAdminSession(token, bad)).toBeNull();
    expect(await verifyAdminSession(token, {})).toBeNull();
  });
});

describe("admin session token", () => {
  it("round-trips subject, location and method", async () => {
    const t = await signAdminSession(payload, TEST_ENV);
    expect(await verifyAdminSession(t, TEST_ENV)).toEqual(payload);
  });

  it("rejects a tampered token, a wrong-secret token and garbage", async () => {
    const t = await signAdminSession(payload, TEST_ENV);
    expect(await verifyAdminSession(t.slice(0, -2) + "xx", TEST_ENV)).toBeNull();
    expect(await verifyAdminSession(t, { ...TEST_ENV, ADMIN_SESSION_SECRET: "z".repeat(40) })).toBeNull();
    expect(await verifyAdminSession("nope", TEST_ENV)).toBeNull();
  });

  it("a tools-session-shaped token signed with the tools secret is not accepted", async () => {
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ userId: "u", locationId: "LOC_HQ" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(TEST_ENV.TOOLS_SESSION_SECRET));
    expect(await verifyAdminSession(forged, TEST_ENV)).toBeNull();
  });
});
