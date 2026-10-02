import { describe, expect, it } from "vitest";
import { discardChallenge, hashOtp, issueChallenge, verifyChallenge } from "../challenge";
import { OTP_MAX_ATTEMPTS, OTP_MAX_SENDS, OTP_SEND_WINDOW_MS, OTP_TTL_MS } from "../config";
import { randomCode6, safeEqualHex } from "../crypto";
import { makeFakeDb, TEST_ENV } from "./fakeDb";

const T0 = new Date("2026-09-27T12:00:00.000Z");

describe("OTP hashing", () => {
  it("is a keyed HMAC bound to the challenge id; the code is never stored", async () => {
    const { db, challenges } = makeFakeDb({ clock: () => T0 });
    const r = await issueChallenge(db, T0, TEST_ENV);
    if (!r.ok) throw new Error("expected issue");
    const stored = challenges.rows[0];
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(r.code);
    expect(stored.codeHash).toBe(hashOtp(r.id, r.code, TEST_ENV));
    expect(hashOtp("other-id", r.code, TEST_ENV)).not.toBe(stored.codeHash); // bound to the challenge
    expect(hashOtp(r.id, r.code, { ...TEST_ENV, ADMIN_SESSION_SECRET: "c".repeat(40) })).not.toBe(stored.codeHash); // keyed
  });

  it("codes are 6 digits", () => {
    for (let i = 0; i < 200; i++) expect(randomCode6()).toMatch(/^\d{6}$/);
  });

  it("safeEqualHex compares by value and rejects length mismatch", () => {
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
    expect(safeEqualHex("abcd", "abce")).toBe(false);
    expect(safeEqualHex("abcd", "abc")).toBe(false);
  });
});

describe("challenge lifecycle", () => {
  it("verifies once, then the challenge is consumed", async () => {
    const { db } = makeFakeDb({ clock: () => T0 });
    const r = await issueChallenge(db, T0, TEST_ENV);
    if (!r.ok) throw new Error();
    expect(await verifyChallenge(db, r.code, T0, TEST_ENV)).toEqual({ ok: true });
    expect(await verifyChallenge(db, r.code, T0, TEST_ENV)).toEqual({ ok: false, reason: "no_challenge" });
  });

  it("allows exactly 5 attempts, then locks even the correct code", async () => {
    const { db } = makeFakeDb({ clock: () => T0 });
    const r = await issueChallenge(db, T0, TEST_ENV);
    if (!r.ok) throw new Error();
    const wrong = r.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect(await verifyChallenge(db, wrong, T0, TEST_ENV)).toEqual({ ok: false, reason: "wrong" });
    expect(await verifyChallenge(db, wrong, T0, TEST_ENV)).toEqual({ ok: false, reason: "locked" });
    expect(await verifyChallenge(db, r.code, T0, TEST_ENV)).toEqual({ ok: false, reason: "locked" });
  });

  it("concurrent guesses can't exceed the attempt cap", async () => {
    const { db, challenges } = makeFakeDb({ clock: () => T0 });
    const r = await issueChallenge(db, T0, TEST_ENV);
    if (!r.ok) throw new Error();
    const wrong = r.code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 20 }, () => verifyChallenge(db, wrong, T0, TEST_ENV)));
    expect(challenges.rows[0].attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it("expires after 10 minutes", async () => {
    const { db } = makeFakeDb({ clock: () => T0 });
    const r = await issueChallenge(db, T0, TEST_ENV);
    if (!r.ok) throw new Error();
    const later = new Date(T0.getTime() + OTP_TTL_MS + 1);
    expect(await verifyChallenge(db, r.code, later, TEST_ENV)).toEqual({ ok: false, reason: "no_challenge" });
    expect(await verifyChallenge(db, r.code, new Date(T0.getTime() + OTP_TTL_MS - 1000), TEST_ENV)).toEqual({ ok: true });
  });

  it("limits sends to 3 per 15 minutes, then frees up", async () => {
    let now = T0;
    const { db } = makeFakeDb({ clock: () => now });
    for (let i = 0; i < OTP_MAX_SENDS; i++) expect((await issueChallenge(db, now, TEST_ENV)).ok).toBe(true);
    expect(await issueChallenge(db, now, TEST_ENV)).toEqual({ ok: false, reason: "rate_limited" });
    now = new Date(T0.getTime() + OTP_SEND_WINDOW_MS + 1000);
    expect((await issueChallenge(db, now, TEST_ENV)).ok).toBe(true);
  });

  it("a new send supersedes the previous code", async () => {
    const { db } = makeFakeDb({ clock: () => T0 });
    const a = await issueChallenge(db, T0, TEST_ENV);
    const b = await issueChallenge(db, T0, TEST_ENV);
    if (!a.ok || !b.ok) throw new Error();
    expect((await verifyChallenge(db, a.code === b.code ? "000000" : a.code, T0, TEST_ENV)).ok).toBe(false);
    expect((await verifyChallenge(db, b.code, T0, TEST_ENV)).ok).toBe(true);
  });

  it("rejects malformed input without touching attempts; discardChallenge removes a challenge", async () => {
    const { db, challenges } = makeFakeDb({ clock: () => T0 });
    const r = await issueChallenge(db, T0, TEST_ENV);
    if (!r.ok) throw new Error();
    expect(await verifyChallenge(db, "12ab56", T0, TEST_ENV)).toEqual({ ok: false, reason: "invalid" });
    expect(challenges.rows[0].attempts).toBe(0);
    await discardChallenge(db, r.id);
    expect(challenges.rows).toHaveLength(0);
  });
});
