import { describe, expect, it } from "vitest";
import { generateBackupCode, hashBackupCode } from "../backupCodes";
import { resolveEntry, resolveFallbackAccount } from "../entry";
import { attemptFallbackLogin, attemptSmsLogin, startEntry } from "../login";
import { checkOwnerToken, AdminAuthError } from "../ownerCheck";
import { signAdminSession } from "../session";
import { totpAt } from "../totp";
import { LOGIN_FAIL_MAX } from "../config";
import { makeFakeDb, OWNER, TEST_ENV, type FakeAccount } from "./fakeDb";

const T0 = new Date("2026-09-27T12:00:00.000Z");
const member: FakeAccount = { id: "acct_member", contactId: "c_member", locationId: "LOC_MEMBER", accountType: "member", user: { id: "u_m", status: "active" } };
const env = TEST_ENV;

describe("resolveEntry (the /admin/enter gate)", () => {
  const ok = (extra: Partial<FakeAccount> = {}) => makeFakeDb({ accounts: [{ ...OWNER, ...extra }] }).db;

  it("passes for an allowlisted, internal account with an active user", async () => {
    expect(await resolveEntry(ok(), "LOC_HQ", env)).toMatchObject({ ok: true, account: { accountId: "acct_owner", contactId: "contact_owner_0001", locationId: "LOC_HQ" } });
  });
  it("missing locationId", async () => expect(await resolveEntry(ok(), "", env)).toEqual({ ok: false, reason: "missing_location" }));
  it("locationId not in ADMIN_LOCATION_IDS (even if the account exists)", async () => {
    const db = makeFakeDb({ accounts: [{ ...OWNER, locationId: "LOC_OTHER" }] }).db;
    expect(await resolveEntry(db, "LOC_OTHER", env)).toEqual({ ok: false, reason: "not_allowlisted" });
  });
  it("allowlist is empty → nothing passes", async () => expect(await resolveEntry(ok(), "LOC_HQ", { ...env, ADMIN_LOCATION_IDS: "" })).toEqual({ ok: false, reason: "not_allowlisted" }));
  it("allowlisted but no account", async () => expect(await resolveEntry(makeFakeDb().db, "LOC_HQ", env)).toEqual({ ok: false, reason: "no_account" }));
  it("a MEMBER account on an allowlisted location is refused", async () => expect(await resolveEntry(ok({ accountType: "member" }), "LOC_HQ", env)).toEqual({ ok: false, reason: "not_internal" }));
  it("user inactive / missing", async () => {
    expect(await resolveEntry(ok({ user: { id: "u", status: "suspended" } }), "LOC_HQ", env)).toEqual({ ok: false, reason: "user_inactive" });
    expect(await resolveEntry(ok({ user: null }), "LOC_HQ", env)).toEqual({ ok: false, reason: "no_user" });
  });
});

describe("resolveFallbackAccount", () => {
  it("returns the single active internal allowlisted account", async () => {
    expect((await resolveFallbackAccount(makeFakeDb({ accounts: [OWNER, member] }).db, env))?.accountId).toBe("acct_owner");
  });
  it("null when none, when the user is inactive, or when ambiguous", async () => {
    expect(await resolveFallbackAccount(makeFakeDb({ accounts: [member] }).db, env)).toBeNull();
    expect(await resolveFallbackAccount(makeFakeDb({ accounts: [{ ...OWNER, user: { id: "u", status: "inactive" } }] }).db, env)).toBeNull();
    const two = { ...OWNER, id: "acct_2", locationId: "LOC_HQ2", contactId: "c2" };
    expect(await resolveFallbackAccount(makeFakeDb({ accounts: [OWNER, two] }).db, { ...env, ADMIN_LOCATION_IDS: "LOC_HQ,LOC_HQ2" })).toBeNull();
  });
});

describe("checkOwnerToken re-verifies on every request", () => {
  const token = () => signAdminSession({ sub: "acct_owner", locationId: "LOC_HQ", method: "sms" }, env);

  it("accepts a valid session for a current internal account", async () => {
    const db = makeFakeDb({ accounts: [OWNER] }).db;
    expect(await checkOwnerToken(await token(), db, env)).toMatchObject({ accountId: "acct_owner", locationId: "LOC_HQ", method: "sms" });
  });
  it("rejects: no token, garbage, account deleted", async () => {
    const db = makeFakeDb({ accounts: [OWNER] }).db;
    await expect(checkOwnerToken(undefined, db, env)).rejects.toThrow(AdminAuthError);
    await expect(checkOwnerToken("garbage", db, env)).rejects.toThrow(AdminAuthError);
    await expect(checkOwnerToken(await token(), makeFakeDb().db, env)).rejects.toThrow(/missing or not internal/);
  });
  it("rejects when the account is no longer internal", async () => {
    await expect(checkOwnerToken(await token(), makeFakeDb({ accounts: [{ ...OWNER, accountType: "member" }] }).db, env)).rejects.toThrow(/not internal/);
  });
  it("rejects when the location is no longer allowlisted", async () => {
    await expect(checkOwnerToken(await token(), makeFakeDb({ accounts: [OWNER] }).db, { ...env, ADMIN_LOCATION_IDS: "SOMETHING_ELSE" })).rejects.toThrow(/not allowlisted/);
  });
  it("rejects when the account's location changed since the token was minted", async () => {
    await expect(checkOwnerToken(await token(), makeFakeDb({ accounts: [{ ...OWNER, locationId: "LOC_MOVED" }] }).db, { ...env, ADMIN_LOCATION_IDS: "LOC_HQ,LOC_MOVED" })).rejects.toThrow(/location mismatch/);
  });
  it("rejects when the user is no longer active", async () => {
    await expect(checkOwnerToken(await token(), makeFakeDb({ accounts: [{ ...OWNER, user: { id: "u", status: "suspended" } }] }).db, env)).rejects.toThrow(/not active/);
  });
});

describe("SMS entry flow", () => {
  it("denied gates send nothing and are audit-logged with a reason", async () => {
    const { db, audit } = makeFakeDb({ accounts: [OWNER] });
    let sent = 0;
    const r = await startEntry(db, "LOC_WRONG", { ip: "1.2.3.4", env, now: T0, send: async () => (sent++, { success: true }) });
    expect(r.status).toBe("denied");
    expect(sent).toBe(0);
    expect(audit.rows[0]).toMatchObject({ action: "login_failed", ip: "1.2.3.4", detail: { stage: "enter", reason: "not_allowlisted" } });
  });

  it("sends the code to the account's contact, then verifies and mints a session for that account", async () => {
    const { db, audit } = makeFakeDb({ accounts: [OWNER], clock: () => T0 });
    let sentTo = "";
    let code = "";
    const r = await startEntry(db, "LOC_HQ", { ip: null, env, now: T0, send: async (c, k) => ((sentTo = c), (code = k), { success: true }) });
    expect(r.status).toBe("sent");
    expect(sentTo).toBe("contact_owner_0001");
    const bad = await attemptSmsLogin(db, "LOC_HQ", code === "000000" ? "111111" : "000000", { ip: null, env, now: T0 });
    expect(bad).toEqual({ ok: false });
    const good = await attemptSmsLogin(db, "LOC_HQ", code, { ip: null, env, now: T0 });
    expect(good).toEqual({ ok: true, session: { sub: "acct_owner", locationId: "LOC_HQ", method: "sms" } });
    expect(audit.rows.map((a) => a.action)).toEqual(["sms_sent", "login_failed", "login_sms"]);
  });

  it("a page reload inside the cooldown does not send again; force (resend) does", async () => {
    const { db } = makeFakeDb({ accounts: [OWNER], clock: () => T0 });
    let sent = 0;
    const send = async () => (sent++, { success: true });
    await startEntry(db, "LOC_HQ", { ip: null, env, now: T0, send });
    expect((await startEntry(db, "LOC_HQ", { ip: null, env, now: T0, send })).status).toBe("cooldown");
    expect(sent).toBe(1);
    expect((await startEntry(db, "LOC_HQ", { ip: null, env, now: T0, send, force: true })).status).toBe("sent");
    expect(sent).toBe(2);
  });

  it("stops at 3 sends per 15 minutes", async () => {
    const { db } = makeFakeDb({ accounts: [OWNER], clock: () => T0 });
    const send = async () => ({ success: true });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await startEntry(db, "LOC_HQ", { ip: null, env, now: T0, send, force: true })).status);
    expect(statuses).toEqual(["sent", "sent", "sent", "rate_limited"]);
  });

  it("a failed SMS delivery discards the challenge", async () => {
    const { db, challenges } = makeFakeDb({ accounts: [OWNER], clock: () => T0 });
    const r = await startEntry(db, "LOC_HQ", { ip: null, env, now: T0, send: async () => ({ success: false }) });
    expect(r.status).toBe("send_failed");
    expect(challenges.rows).toHaveLength(0);
  });

  it("verification re-runs the gate: the account being demoted invalidates a live code", async () => {
    const fake = makeFakeDb({ accounts: [{ ...OWNER }], clock: () => T0 });
    let code = "";
    await startEntry(fake.db, "LOC_HQ", { ip: null, env, now: T0, send: async (_c, k) => ((code = k), { success: true }) });
    fake.accounts[0].accountType = "member";
    expect(await attemptSmsLogin(fake.db, "LOC_HQ", code, { ip: null, env, now: T0 })).toEqual({ ok: false });
  });
});

describe("fallback login (TOTP / backup code)", () => {
  it("accepts a current TOTP once and refuses replay of the same step", async () => {
    const { db, audit } = makeFakeDb({ accounts: [OWNER], clock: () => T0 });
    const code = totpAt(env.ADMIN_TOTP_SECRET, T0.getTime());
    expect(await attemptFallbackLogin(db, code, { ip: null, env, now: T0 })).toEqual({ ok: true, session: { sub: "acct_owner", locationId: "LOC_HQ", method: "totp" } });
    expect((audit.rows.find((a) => a.action === "login_totp")?.detail as { step: number }).step).toBeTypeOf("number");
    expect(await attemptFallbackLogin(db, code, { ip: null, env, now: T0 })).toEqual({ ok: false }); // replay
  });

  it("accepts a backup code once", async () => {
    const { db } = makeFakeDb({ accounts: [OWNER], clock: () => T0 });
    const code = generateBackupCode();
    await db.adminBackupCode.create({ data: { codeHash: hashBackupCode(code) } });
    expect((await attemptFallbackLogin(db, code, { ip: null, env, now: T0 })).ok).toBe(true);
    expect((await attemptFallbackLogin(db, code, { ip: null, env, now: T0 })).ok).toBe(false);
  });

  it("wrong / malformed input fails generically; TOTP unconfigured fails closed", async () => {
    const { db, audit } = makeFakeDb({ accounts: [OWNER], clock: () => T0 });
    expect(await attemptFallbackLogin(db, "123456", { ip: null, env, now: T0 })).toEqual({ ok: false });
    expect(await attemptFallbackLogin(db, "hello", { ip: null, env, now: T0 })).toEqual({ ok: false });
    expect(await attemptFallbackLogin(db, "123456", { ip: null, env: { ...env, ADMIN_TOTP_SECRET: undefined }, now: T0 })).toEqual({ ok: false });
    expect(audit.rows.every((a) => a.action === "login_failed")).toBe(true);
  });

  it("no internal account → fails; after 10 failures everything is throttled, even a correct code", async () => {
    expect(await attemptFallbackLogin(makeFakeDb({ accounts: [member], clock: () => T0 }).db, "123456", { ip: null, env, now: T0 })).toEqual({ ok: false });
    const { db } = makeFakeDb({ accounts: [OWNER], clock: () => T0 });
    for (let i = 0; i < LOGIN_FAIL_MAX; i++) await attemptFallbackLogin(db, "000000", { ip: null, env, now: T0 });
    expect(await attemptFallbackLogin(db, totpAt(env.ADMIN_TOTP_SECRET, T0.getTime()), { ip: null, env, now: T0 })).toEqual({ ok: false });
    const later = new Date(T0.getTime() + 16 * 60 * 1000);
    expect((await attemptFallbackLogin(db, totpAt(env.ADMIN_TOTP_SECRET, later.getTime()), { ip: null, env, now: later })).ok).toBe(true);
  });
});
