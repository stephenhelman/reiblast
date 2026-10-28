import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleOtpConfirm, handleOtpStart, MAX_CONFIRMS_PER_ACCOUNT, MAX_STARTS_PER_ACCOUNT } from "../otp";
import { FOUNDERS_COOKIE_OPTIONS, signFoundersSession, verifyFoundersSession } from "../session";

const D1 = "111111111111111111";
const ID = { ghlAccountId: "A1", discordUserId: D1 };
const NOW = new Date("2026-10-29T01:00:00Z");
const ENV = { FOUNDER_CLAIMS_OPEN_AT: "2026-10-29T00:00:00Z", FOUNDER_CLAIMS_CLOSE_AT: "2026-11-01T04:59:59Z" };

function makeDb(over: { otpLastSentAt?: Date | null; linked?: boolean; attempts?: any[] } = {}) {
  const attempts: any[] = over.attempts ?? [];
  const user = { id: "U1", otpLastSentAt: over.otpLastSentAt ?? null };
  const ok = (w: any, a: any) => a.kind === w.kind && a.ghlAccountId === w.ghlAccountId && (!w.discordUserId || a.discordUserId === w.discordUserId) && (!w.createdAt || a.createdAt >= w.createdAt.gte);
  return {
    attempts, user,
    ghlAccount: { findUnique: async () => ({ contactId: "HQC1", user }) },
    discordLink: { findFirst: async () => (over.linked === false ? null : { id: "L1" }) },
    founderVerifyAttempt: {
      create: async ({ data }: any) => void attempts.push(data),
      count: async ({ where }: any) => attempts.filter((a) => ok(where, a)).length,
      findFirst: async ({ where }: any) => attempts.filter((a) => ok(where, a)).sort((x, y) => y.createdAt - x.createdAt)[0] ?? null,
    },
  };
}
const start = (db: any, extra: Record<string, any> = {}) => handleOtpStart({ db, now: () => NOW, env: ENV, mintOtp: vi.fn(async () => ({ success: true as const })), fetchPhoneLast4: async () => "4321", ...extra }, ID);
const confirm = (db: any, verifyOtp: any, now = NOW) => handleOtpConfirm({ db, now: () => now, env: ENV, verifyOtp }, { ...ID, code: "123456" });

describe("handleOtpStart", () => {
  it("mints with the founders flow, writes start then a sent binding after the mint", async () => {
    const db = makeDb();
    const mintOtp = vi.fn(async () => ({ success: true as const }));
    expect(await start(db, { mintOtp })).toEqual({ result: "sent", phoneLast4: "4321" });
    expect(mintOtp).toHaveBeenCalledWith(expect.objectContaining({ userId: "U1", contactId: "HQC1", flow: "founders" }));
    expect(db.attempts.map((a) => a.kind)).toEqual(["start", "sent"]);
  });
  it("outside the window nothing is sent or written", async () => {
    const db = makeDb();
    const mintOtp = vi.fn();
    const r = await handleOtpStart({ db, now: () => new Date("2026-10-28T23:00:00Z"), env: ENV, mintOtp, fetchPhoneLast4: async () => "1" }, ID);
    expect(r).toEqual({ result: "refused", reason: "not_open" });
    expect(mintOtp).not.toHaveBeenCalled();
    expect(db.attempts).toHaveLength(0);
  });
  it("a start whose Discord link is gone is refused after the attempt row is written", async () => {
    const db = makeDb({ linked: false });
    expect(await start(db)).toEqual({ result: "refused", reason: "link_invalid" });
    expect(db.attempts.map((a) => a.kind)).toEqual(["start"]);
  });
  it(`rate limit: ${MAX_STARTS_PER_ACCOUNT} starts per hour per account`, async () => {
    const prior = Array.from({ length: MAX_STARTS_PER_ACCOUNT }, () => ({ kind: "start", ghlAccountId: "A1", discordUserId: D1, createdAt: new Date(NOW.getTime() - 600_000) }));
    expect(await start(makeDb({ attempts: [...prior] }))).toEqual({ result: "refused", reason: "rate_limited" });
    expect(await start(makeDb({ attempts: prior.slice(1) }))).toMatchObject({ result: "sent" });
  });
  it("cooldown after a recent send, and delivery failures are reported", async () => {
    expect(await start(makeDb({ otpLastSentAt: new Date(NOW.getTime() - 1000) }))).toEqual({ result: "refused", reason: "rate_limited" });
    expect(await start(makeDb(), { fetchPhoneLast4: async () => null })).toEqual({ result: "refused", reason: "delivery_failed" });
    const db = makeDb();
    expect(await start(db, { mintOtp: async () => ({ success: false, reason: "delivery_failed" }) })).toEqual({ result: "refused", reason: "delivery_failed" });
    expect(db.attempts.map((a) => a.kind)).toEqual(["start"]);
  });
});

describe("handleOtpConfirm — binding", () => {
  const sent = (at: Date) => ({ kind: "sent", ghlAccountId: "A1", discordUserId: D1, createdAt: at });
  const T = (ms: number) => new Date(NOW.getTime() + ms);
  let verifyOtp: any;
  beforeEach(() => { verifyOtp = vi.fn(async () => ({ status: "success" })); });

  it("with a fresh sent binding and a good code → verified (userId + ghlAccountId)", async () => {
    expect(await confirm(makeDb({ attempts: [sent(T(-60_000))], otpLastSentAt: T(-61_000) }), verifyOtp)).toEqual({ result: "verified", userId: "U1", ghlAccountId: "A1" });
  });
  it("no sent binding → invalid_code, verifyOtp never called", async () => {
    expect(await confirm(makeDb(), verifyOtp)).toEqual({ result: "refused", reason: "invalid_code" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });
  it("a code minted by another flow after our send (otpLastSentAt newer) is refused without consuming it", async () => {
    expect(await confirm(makeDb({ attempts: [sent(T(-120_000))], otpLastSentAt: T(-30_000) }), verifyOtp)).toEqual({ result: "refused", reason: "invalid_code" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });
  it("a binding older than 10 minutes is refused; a binding for another Discord id doesn't count", async () => {
    expect(await confirm(makeDb({ attempts: [sent(T(-11 * 60_000))] }), verifyOtp)).toMatchObject({ reason: "invalid_code" });
    expect(await confirm(makeDb({ attempts: [{ ...sent(T(-1000)), discordUserId: "222222222222222222" }] }), verifyOtp)).toMatchObject({ reason: "invalid_code" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });
  it("maps wrong / expired / locked_out", async () => {
    const db = () => makeDb({ attempts: [sent(T(-1000))] });
    expect(await confirm(db(), async () => ({ status: "wrong", attemptsRemaining: 2 }))).toEqual({ result: "refused", reason: "invalid_code", attemptsRemaining: 2 });
    expect(await confirm(db(), async () => ({ status: "expired" }))).toEqual({ result: "refused", reason: "code_expired" });
    expect(await confirm(db(), async () => ({ status: "locked_out" }))).toEqual({ result: "refused", reason: "code_locked" });
  });
  it(`rate limit: more than ${MAX_CONFIRMS_PER_ACCOUNT} confirms per hour per account`, async () => {
    const prior = Array.from({ length: MAX_CONFIRMS_PER_ACCOUNT }, () => ({ kind: "confirm", ghlAccountId: "A1", discordUserId: D1, createdAt: T(-5000) }));
    expect(await confirm(makeDb({ attempts: [sent(T(-1000)), ...prior] }), verifyOtp)).toEqual({ result: "refused", reason: "rate_limited" });
  });
});

describe("founders session", () => {
  beforeEach(() => { process.env.FOUNDERS_SESSION_SECRET = "session-secret-for-tests-0123456789"; });
  it("round-trips { userId, ghlAccountId }; tampered or wrong-secret tokens fail", async () => {
    const t = await signFoundersSession({ userId: "U1", ghlAccountId: "A1" });
    expect(await verifyFoundersSession(t)).toEqual({ userId: "U1", ghlAccountId: "A1" });
    expect(await verifyFoundersSession(t.slice(0, -2) + "xx")).toBeNull();
    process.env.FOUNDERS_SESSION_SECRET = "another-secret-0123456789abcdefghij";
    expect(await verifyFoundersSession(t)).toBeNull();
  });
  it("cookie options: httpOnly, secure, lax, /founders, 30 minutes, no Domain", () => {
    expect(FOUNDERS_COOKIE_OPTIONS).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/founders", maxAge: 1800 });
  });
});
