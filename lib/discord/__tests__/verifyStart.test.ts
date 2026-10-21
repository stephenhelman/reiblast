import { describe, expect, it, vi } from "vitest";
import {
  ELIGIBLE_STATUSES, MAX_STARTS_PER_DISCORD_ID, MAX_STARTS_PER_MEMBER, handleVerifyStart, isEligible, normalizeEmail, parseIdentity,
  type VerifyDb, type VerifyStartDeps,
} from "../verify";

type Acct = { id: string; contactId: string; accountType: string; email: string; locationId: string | null; user: { id: string; status: string; otpLastSentAt: Date | null; ghlLocationId?: string | null } };
type Row = Record<string, any>;

const NOW = new Date("2026-10-20T12:00:00Z");
const D1 = "111111111111111111";
const D2 = "222222222222222222";

const acct = (over: Partial<Acct> & { status?: string } = {}): Acct => ({
  id: "A1", contactId: "CONTACT1abcd", accountType: "member", email: "member@example.test", locationId: "LOC_ONE",
  user: { id: "U1", status: over.status ?? "onboarding_complete", otpLastSentAt: null, ghlLocationId: over.locationId === undefined ? "LOC_ONE" : over.locationId },
  ...over,
});

/** In-memory stand-in for the slice of Prisma that verify-start uses. */
function fakeDb(accounts: Acct[], links: Row[] = [], attempts: Row[] = []) {
  const eq = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, c]) => (k === "OR" ? (c as Row[]).some((x) => eq(r, x)) : c && typeof c === "object" && "gte" in c ? r[k] >= c.gte : r[k] === c));
  const db = {
    ghlAccount: {
      findMany: async ({ where }: Row) =>
        accounts
          .filter((a) => ("user" in where && "email" in where.user ? a.email === where.user.email : where.OR.some((o: Row) => o.locationId === a.locationId || o.user?.ghlLocationId === a.user.ghlLocationId)))
          .map((a) => ({ id: a.id, contactId: a.contactId, accountType: a.accountType, locationId: a.locationId, user: a.user })),
    },
    discordLink: { findFirst: async ({ where }: Row) => links.find((l) => eq(l, where)) ?? null },
    discordVerifyAttempt: {
      create: async ({ data }: Row) => void attempts.push({ ...data }),
      count: async ({ where }: Row) => attempts.filter((a) => eq(a, where)).length,
    },
  };
  return { db: db as unknown as VerifyDb, links, attempts };
}

function setup(accounts: Acct[], links: Row[] = [], attempts: Row[] = [], over: Partial<VerifyStartDeps> = {}) {
  const f = fakeDb(accounts, links, attempts);
  const mintOtp = vi.fn(async () => ({ success: true as const }));
  const fetchPhoneLast4 = vi.fn(async () => "1234" as string | null);
  const deps: VerifyStartDeps = { db: f.db, mintOtp, fetchPhoneLast4, now: () => NOW, ...over };
  return { ...f, mintOtp, fetchPhoneLast4, deps };
}
const byEmail = (email = "member@example.test", discordUserId = D1) => ({ discordUserId, identifier: { email } });

describe("email normalization and request parsing", () => {
  it("lowercases AND trims", () => {
    expect(normalizeEmail("  Member@Example.TEST \n")).toBe("member@example.test");
    expect(parseIdentity({ discordUserId: D1, email: "  Member@Example.TEST " })).toEqual({ discordUserId: D1, identifier: { email: "member@example.test" } });
  });
  it("accepts a location id (trimmed) instead of an email", () => {
    expect(parseIdentity({ discordUserId: D1, locationId: " LOC_ONE " })).toEqual({ discordUserId: D1, identifier: { locationId: "LOC_ONE" } });
  });
  it("rejects: both identifiers, neither, non-snowflake Discord id, malformed email/location, non-strings", () => {
    expect(parseIdentity({ discordUserId: D1, email: "a@b.test", locationId: "LOC_ONE" })).toBeNull();
    expect(parseIdentity({ discordUserId: D1 })).toBeNull();
    expect(parseIdentity({ discordUserId: "abc", email: "a@b.test" })).toBeNull();
    expect(parseIdentity({ discordUserId: D1, email: "not-an-email" })).toBeNull();
    expect(parseIdentity({ discordUserId: D1, locationId: "has space" })).toBeNull();
    expect(parseIdentity({ discordUserId: D1, email: 5 })).toBeNull();
    expect(parseIdentity({ discordUserId: 111111111111111111, email: "a@b.test" })).toBeNull();
  });
});

describe("eligibility", () => {
  it.each(ELIGIBLE_STATUSES.map((s) => [s]))("%s is eligible", (status) => {
    const a = acct({ status });
    expect(isEligible({ id: a.id, contactId: a.contactId, accountType: a.accountType, user: a.user })).toBe(true);
  });
  it.each([["pending_onboarding"], ["suspended"], ["inactive"], ["churned"], [""], ["something_new"]])("status %j fails closed", async (status) => {
    const t = setup([acct({ status })]);
    expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "refused", reason: "not_eligible" });
    expect(t.mintOtp).not.toHaveBeenCalled();
  });
  it("non-member account types and test_ contacts are not eligible", async () => {
    for (const a of [acct({ accountType: "internal" }), acct({ contactId: "test_abc123" })]) {
      const t = setup([a]);
      expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "refused", reason: "not_eligible" });
      expect(t.mintOtp).not.toHaveBeenCalled();
    }
  });
  it("an eligible member with no location id yet (pre-provisioning) can start", async () => {
    const t = setup([acct({ locationId: null, status: "onboarding_complete" })]);
    expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "code_sent", reason: "code_sent", phoneLast4: "1234" });
  });
  it("resolves by location id too", async () => {
    const t = setup([acct()]);
    expect((await handleVerifyStart(t.deps, { discordUserId: D1, identifier: { locationId: "LOC_ONE" } })).result).toBe("code_sent");
  });
  it("location id: GhlAccount.locationId and User.ghlLocationId disagreeing → not_eligible, identical to not_found, fixed marker logged with no ids", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = acct();
    a.user.ghlLocationId = "LOC_OTHER";
    for (const lookup of ["LOC_ONE", "LOC_OTHER"]) {
      const t = setup([a]);
      const body = await handleVerifyStart(t.deps, { discordUserId: D1, identifier: { locationId: lookup } });
      expect(body).toEqual({ result: "refused", reason: "not_eligible" });
      expect(t.mintOtp).not.toHaveBeenCalled();
      expect(t.attempts[0]).toMatchObject({ ghlAccountId: null }); // same side effects as not_found
    }
    expect(warn.mock.calls).toEqual([["[discord/verify] location_id_mismatch"], ["[discord/verify] location_id_mismatch"]]);
    warn.mockRestore();
  });
  it("location id: one side null (not provisioned on that table yet) is not a mismatch", async () => {
    const a = acct();
    a.user.ghlLocationId = null;
    expect((await handleVerifyStart(setup([a]).deps, { discordUserId: D1, identifier: { locationId: "LOC_ONE" } })).result).toBe("code_sent");
  });
  it("location id matching two different accounts is treated as a mismatch, not resolved arbitrarily", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup([acct(), acct({ id: "A2", contactId: "CONTACT2abcd", email: "two@example.test" })]);
    expect(await handleVerifyStart(t.deps, { discordUserId: D1, identifier: { locationId: "LOC_ONE" } })).toEqual({ result: "refused", reason: "not_eligible" });
    expect(t.mintOtp).not.toHaveBeenCalled();
  });
});

describe("code_sent path", () => {
  it("mints a discord-flow OTP for the account's HQ contact and returns only the last 4 digits", async () => {
    const t = setup([acct()]);
    const out = await handleVerifyStart(t.deps, byEmail());
    expect(out).toEqual({ result: "code_sent", reason: "code_sent", phoneLast4: "1234" });
    expect(t.fetchPhoneLast4).toHaveBeenCalledWith("CONTACT1abcd");
    expect(t.mintOtp).toHaveBeenCalledWith({ userId: "U1", contactId: "CONTACT1abcd", phone: "", flow: "discord" });
    expect(JSON.stringify(out)).not.toMatch(/example\.test|CONTACT1/);
  });
  it("a failed phone lookup or SMS send is delivery_failed, and no SMS is sent when the lookup fails", async () => {
    const noPhone = setup([acct()], [], [], { fetchPhoneLast4: vi.fn(async () => null) });
    expect(await handleVerifyStart(noPhone.deps, byEmail())).toEqual({ result: "refused", reason: "delivery_failed" });
    expect(noPhone.mintOtp).not.toHaveBeenCalled();
    const noSms = setup([acct()], [], [], { mintOtp: vi.fn(async () => ({ success: false as const, reason: "delivery_failed" as const })) });
    expect(await handleVerifyStart(noSms.deps, byEmail())).toEqual({ result: "refused", reason: "delivery_failed" });
  });
  it("the 60s send cooldown (User.otpLastSentAt) returns rate_limited without sending", async () => {
    const a = acct();
    a.user.otpLastSentAt = new Date(NOW.getTime() - 30_000);
    const t = setup([a]);
    expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "refused", reason: "rate_limited" });
    expect(t.mintOtp).not.toHaveBeenCalled();
    a.user.otpLastSentAt = new Date(NOW.getTime() - 61_000);
    expect((await handleVerifyStart(t.deps, byEmail())).result).toBe("code_sent");
  });
});

describe("already linked", () => {
  const link = (discordUserId: string) => [{ ghlAccountId: "A1", discordUserId }];
  it("linked to THIS Discord id → success, no code, no GHL call", async () => {
    const t = setup([acct()], link(D1));
    expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "linked", reason: "linked" });
    expect(t.mintOtp).not.toHaveBeenCalled();
    expect(t.fetchPhoneLast4).not.toHaveBeenCalled();
  });
  it("member linked to a DIFFERENT Discord id → already_linked", async () => {
    const t = setup([acct()], link(D2));
    expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "refused", reason: "already_linked" });
    expect(t.mintOtp).not.toHaveBeenCalled();
  });
  it("this Discord id already linked to a DIFFERENT member → already_linked", async () => {
    const t = setup([acct()], [{ ghlAccountId: "OTHER", discordUserId: D1 }]);
    expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "refused", reason: "already_linked" });
  });
});

describe("rate limiting (DB-backed)", () => {
  const prior = (n: number, over: Row) => Array.from({ length: n }, () => ({ kind: "start", createdAt: new Date(NOW.getTime() - 60_000), ...over }));
  it(`more than ${MAX_STARTS_PER_DISCORD_ID} starts per Discord id in an hour → rate_limited, even for an unknown email`, async () => {
    const t = setup([], [], prior(MAX_STARTS_PER_DISCORD_ID, { discordUserId: D1, ghlAccountId: null }));
    expect(await handleVerifyStart(t.deps, byEmail("nobody@example.test"))).toEqual({ result: "refused", reason: "rate_limited" });
  });
  it("the limit is exactly the 6th attempt: the 5th still gets through", async () => {
    const t = setup([acct()], [], prior(MAX_STARTS_PER_DISCORD_ID - 1, { discordUserId: D1, ghlAccountId: null }));
    expect((await handleVerifyStart(t.deps, byEmail())).result).toBe("code_sent");
  });
  it(`more than ${MAX_STARTS_PER_MEMBER} starts per member (from any Discord id) → rate_limited`, async () => {
    const t = setup([acct()], [], prior(MAX_STARTS_PER_MEMBER, { discordUserId: D2, ghlAccountId: "A1" }));
    expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "refused", reason: "rate_limited" });
    expect(t.mintOtp).not.toHaveBeenCalled();
  });
  it("attempts older than the window don't count", async () => {
    const old = prior(10, { discordUserId: D1, ghlAccountId: "A1" }).map((r) => ({ ...r, createdAt: new Date(NOW.getTime() - 2 * 3600_000) }));
    const t = setup([acct()], [], old);
    expect((await handleVerifyStart(t.deps, byEmail())).result).toBe("code_sent");
  });
  it("confirm-kind rows don't count toward start limits", async () => {
    const t = setup([acct()], [], prior(20, { discordUserId: D1, ghlAccountId: "A1" }).map((r) => ({ ...r, kind: "confirm" })));
    expect((await handleVerifyStart(t.deps, byEmail())).result).toBe("code_sent");
  });
  it("an ineligible existing account can't be told apart by the per-member limit (it is checked after eligibility)", async () => {
    const t = setup([acct({ status: "suspended" })], [], prior(MAX_STARTS_PER_MEMBER + 1, { discordUserId: D2, ghlAccountId: "A1" }));
    expect(await handleVerifyStart(t.deps, byEmail())).toEqual({ result: "refused", reason: "not_eligible" });
  });
});

describe("not_found and not_eligible are indistinguishable", () => {
  it("identical body AND identical side effects (one attempt row, no OTP, no GHL), across every ineligible kind", async () => {
    const notFound = setup([]);
    const nfBody = await handleVerifyStart(notFound.deps, byEmail("ghost@example.test"));
    expect(notFound.attempts).toHaveLength(1);
    for (const a of [acct({ status: "suspended" }), acct({ status: "pending_onboarding" }), acct({ accountType: "internal" }), acct({ contactId: "test_x1y2z3" })]) {
      const t = setup([a]);
      const body = await handleVerifyStart(t.deps, byEmail());
      expect(JSON.stringify(body)).toBe(JSON.stringify(nfBody));
      expect(t.attempts).toHaveLength(1);
      expect(t.attempts[0]).toMatchObject({ kind: "start", discordUserId: D1 });
      expect(t.mintOtp).not.toHaveBeenCalled();
      expect(t.fetchPhoneLast4).not.toHaveBeenCalled();
    }
    expect(notFound.attempts[0]).toMatchObject({ kind: "start", discordUserId: D1, ghlAccountId: null });
    expect(notFound.mintOtp).not.toHaveBeenCalled();
  });
  it("the attempt row is written even when the request is then rate limited (record before any early return)", async () => {
    const t = setup([], [], Array.from({ length: 6 }, () => ({ kind: "start", discordUserId: D1, ghlAccountId: null, createdAt: NOW })));
    await handleVerifyStart(t.deps, byEmail("ghost@example.test"));
    expect(t.attempts).toHaveLength(7);
  });
});
