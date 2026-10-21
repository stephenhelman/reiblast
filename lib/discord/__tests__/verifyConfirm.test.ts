import { describe, expect, it, vi } from "vitest";
import { MAX_CONFIRMS_PER_DISCORD_ID, handleVerifyConfirm, parseConfirm, type ConfirmDb, type VerifyConfirmDeps } from "../verify";
import type { VerifyOtpResult } from "@/lib/otp";

type Row = Record<string, any>;
const NOW = new Date("2026-10-20T12:00:00Z");
const D1 = "111111111111111111";
const D2 = "222222222222222222";
const CODE = "123456";

type Acct = { id: string; contactId: string; accountType: string; email: string; locationId: string | null; user: { id: string; status: string; otpLastSentAt: Date | null; ghlLocationId: string | null } };
const acct = (over: Partial<Acct> & { status?: string } = {}): Acct => ({
  id: "A1", contactId: "CONTACT1abcd", accountType: "member", email: "member@example.test", locationId: "LOC_ONE",
  user: { id: "U1", status: over.status ?? "onboarding_complete", otpLastSentAt: null, ghlLocationId: "LOC_ONE" },
  ...over,
});

/** In-memory Prisma stand-in; discordLink.create enforces BOTH unique constraints with a Prisma-shaped P2002, like the real table. */
function fakeDb(accounts: Acct[], links: Row[] = [], attempts: Row[] = [], opts: { race?: () => void; createError?: Row } = {}) {
  const eq = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, c]) => (k === "OR" ? (c as Row[]).some((x) => eq(r, x)) : c && typeof c === "object" && "gte" in c ? r[k] >= c.gte : r[k] === c));
  const discordLink = {
    findFirst: async ({ where }: Row) => links.find((l) => eq(l, where)) ?? null,
    create: async ({ data }: Row) => {
      opts.race?.(); // a competing request lands between our check and our insert
      if (opts.createError) throw Object.assign(new Error("db"), opts.createError);
      if (links.some((l) => l.ghlAccountId === data.ghlAccountId || l.discordUserId === data.discordUserId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      links.push({ ...data });
      return data;
    },
  };
  const db = {
    ghlAccount: {
      findMany: async ({ where }: Row) =>
        accounts
          .filter((a) => ("user" in where && "email" in where.user ? a.email === where.user.email : where.OR.some((o: Row) => o.locationId === a.locationId || o.user?.ghlLocationId === a.user.ghlLocationId)))
          .map((a) => ({ id: a.id, contactId: a.contactId, accountType: a.accountType, locationId: a.locationId, user: a.user })),
    },
    discordLink,
    discordVerifyAttempt: {
      create: async ({ data }: Row) => void attempts.push({ ...data }),
      count: async ({ where }: Row) => attempts.filter((a) => eq(a, where)).length,
      findFirst: async ({ where }: Row) => attempts.filter((a) => eq(a, where)).sort((x, y) => y.createdAt - x.createdAt)[0] ?? null,
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn({ discordLink }),
  };
  return { db: db as unknown as ConfirmDb, links, attempts };
}

/** By default a verify-start already sent this Discord id + member a code a minute ago (the binding verify-confirm requires). */
const sentRow = (over: Row = {}) => ({ kind: "sent", discordUserId: D1, ghlAccountId: "A1", createdAt: new Date(NOW.getTime() - 60_000), ...over });
const confirmRows = (t: { attempts: Row[] }) => t.attempts.filter((a) => a.kind === "confirm");

function setup(accounts: Acct[], links: Row[] = [], attempts: Row[] = [], otp: VerifyOtpResult = { status: "success" }, opts: Parameters<typeof fakeDb>[3] & { noSent?: boolean } = {}) {
  const f = fakeDb(accounts, links, opts.noSent ? attempts : [sentRow(), ...attempts], opts);
  const verifyOtp = vi.fn(async () => otp);
  const deps: VerifyConfirmDeps = { db: f.db, verifyOtp, now: () => NOW };
  return { ...f, verifyOtp, deps };
}
const input = (over: Row = {}) => ({ discordUserId: D1, identifier: { email: "member@example.test" }, code: CODE, ...over });

describe("parseConfirm", () => {
  it("requires a 6-digit string code on top of verify-start's identity rules (email trimmed/lowercased)", () => {
    expect(parseConfirm({ discordUserId: D1, email: " Member@Example.TEST ", code: " 123456 " })).toEqual({ discordUserId: D1, identifier: { email: "member@example.test" }, code: "123456" });
    for (const code of [undefined, 123456, "12345", "1234567", "12345a", ""]) expect(parseConfirm({ discordUserId: D1, email: "a@b.test", code })).toBeNull();
    expect(parseConfirm({ discordUserId: D1, code: CODE })).toBeNull();
    expect(parseConfirm({ discordUserId: D1, email: "a@b.test", locationId: "LOC_ONE", code: CODE })).toBeNull();
  });
});

describe("happy path and idempotency", () => {
  it("valid code → link created for exactly this member + Discord id, OTP verified against the member's User", async () => {
    const t = setup([acct()]);
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "linked", reason: "linked" });
    expect(t.links).toEqual([{ ghlAccountId: "A1", discordUserId: D1 }]);
    expect(t.verifyOtp).toHaveBeenCalledWith({ userId: "U1", code: CODE });
  });
  it("works by location id, and for a member with no location id yet via email", async () => {
    expect((await handleVerifyConfirm(setup([acct()]).deps, input({ identifier: { locationId: "LOC_ONE" } }))).result).toBe("linked");
    expect((await handleVerifyConfirm(setup([acct({ locationId: null })]).deps, input())).result).toBe("linked");
  });
  it("confirming again for the same pair → linked, no second row, and no live code needed", async () => {
    const t = setup([acct()]);
    await handleVerifyConfirm(t.deps, input());
    t.verifyOtp.mockClear();
    expect(await handleVerifyConfirm(t.deps, input({ code: "000000" }))).toEqual({ result: "linked", reason: "linked" });
    expect(t.links).toHaveLength(1);
    expect(t.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("conflicts", () => {
  it("member linked to a different Discord id → already_linked (code not consumed)", async () => {
    const t = setup([acct()], [{ ghlAccountId: "A1", discordUserId: D2 }]);
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "refused", reason: "already_linked" });
    expect(t.verifyOtp).not.toHaveBeenCalled();
    expect(t.links).toHaveLength(1);
  });
  it("this Discord id linked to a different member → already_linked", async () => {
    const t = setup([acct()], [{ ghlAccountId: "OTHER", discordUserId: D1 }]);
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "refused", reason: "already_linked" });
  });
  it("race on the member's unique constraint (another Discord id wins between check and insert) → already_linked, never a throw", async () => {
    const links: Row[] = [];
    const t = setup([acct()], links, [], { status: "success" }, { race: () => void links.push({ ghlAccountId: "A1", discordUserId: D2 }) });
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "refused", reason: "already_linked" });
    expect(links).toEqual([{ ghlAccountId: "A1", discordUserId: D2 }]);
  });
  it("race on the Discord id's unique constraint (this Discord id grabs another member) → already_linked", async () => {
    const links: Row[] = [];
    const t = setup([acct()], links, [], { status: "success" }, { race: () => void links.push({ ghlAccountId: "OTHER", discordUserId: D1 }) });
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "refused", reason: "already_linked" });
  });
  it("race where a duplicate request for the SAME pair wins → linked (idempotent), not an error", async () => {
    const links: Row[] = [];
    const t = setup([acct()], links, [], { status: "success" }, { race: () => void links.push({ ghlAccountId: "A1", discordUserId: D1 }) });
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "linked", reason: "linked" });
    expect(links).toHaveLength(1);
  });
  it("account deleted mid-flight (FK violation) → not_eligible; any other DB error propagates (route turns it into internal_error)", async () => {
    expect(await handleVerifyConfirm(setup([acct()], [], [], { status: "success" }, { createError: { code: "P2003" } }).deps, input())).toEqual({ result: "refused", reason: "not_eligible" });
    await expect(handleVerifyConfirm(setup([acct()], [], [], { status: "success" }, { createError: { code: "P1001" } }).deps, input())).rejects.toThrow();
  });
});

describe("code validation", () => {
  it.each([
    [{ status: "wrong", attemptsRemaining: 2 } as VerifyOtpResult, { result: "refused", reason: "invalid_code", attemptsRemaining: 2 }],
    [{ status: "expired" } as VerifyOtpResult, { result: "refused", reason: "code_expired" }],
    [{ status: "locked_out" } as VerifyOtpResult, { result: "refused", reason: "code_locked" }],
  ])("verifyOtp %j → %j and no link is created", async (otp, want) => {
    const t = setup([acct()], [], [], otp);
    expect(await handleVerifyConfirm(t.deps, input())).toEqual(want);
    expect(t.links).toHaveLength(0);
  });
});

describe("confirm is bound to its own verify-start", () => {
  const unbound = async (t: ReturnType<typeof setup>) => {
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "refused", reason: "invalid_code" }); // no attemptsRemaining
    expect(t.verifyOtp).not.toHaveBeenCalled(); // nothing consumed, nothing counted against the member's code
    expect(t.links).toHaveLength(0);
  };
  it("no prior start at all → invalid_code, verifyOtp not called", async () => unbound(setup([acct()], [], [], { status: "success" }, { noSent: true })));
  it("a start for a DIFFERENT Discord id → invalid_code", async () => unbound(setup([acct()], [], [sentRow({ discordUserId: D2 })], { status: "success" }, { noSent: true })));
  it("a start for a DIFFERENT member → invalid_code", async () => unbound(setup([acct()], [], [sentRow({ ghlAccountId: "A2" })], { status: "success" }, { noSent: true })));
  it("a start older than the 10-minute OTP window → invalid_code", async () =>
    unbound(setup([acct()], [], [sentRow({ createdAt: new Date(NOW.getTime() - 10 * 60_000 - 1000) })], { status: "success" }, { noSent: true })));
  it("a start that sent NO code (only a kind=start row, e.g. refused by the cooldown) doesn't count → a tools/onboarding code can't be redeemed", async () =>
    unbound(setup([acct()], [], [sentRow({ kind: "start" })], { status: "success" }, { noSent: true })));
  it("a tools/onboarding code minted AFTER the Discord send overwrote the slot (User.otpLastSentAt is newer) → invalid_code", async () => {
    const a = acct();
    a.user.otpLastSentAt = new Date(NOW.getTime() - 30_000); // newer than the sent row (60s ago)
    await unbound(setup([a]));
  });
  it("valid start (same Discord id + member, just under 10 minutes, no later mint) → proceeds to verifyOtp and links", async () => {
    const mintedAt = new Date(NOW.getTime() - 9 * 60_000);
    const a = acct();
    a.user.otpLastSentAt = new Date(mintedAt.getTime() - 1000); // the Discord mint itself: set just before the marker was written
    const t = setup([a], [], [sentRow({ createdAt: mintedAt })], { status: "success" }, { noSent: true });
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "linked", reason: "linked" });
    expect(t.verifyOtp).toHaveBeenCalledTimes(1);
  });
  it("the binding doesn't block an idempotent repeat for an already-linked pair (no code involved)", async () => {
    const t = setup([acct()], [{ ghlAccountId: "A1", discordUserId: D1 }], [], { status: "success" }, { noSent: true });
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "linked", reason: "linked" });
  });
});

describe("eligibility is re-run at confirm time", () => {
  it.each([["suspended"], ["inactive"], ["pending_onboarding"], ["something_new"]])("status now %j → not_eligible, code never checked, no link", async (status) => {
    const t = setup([acct({ status })]);
    expect(await handleVerifyConfirm(t.deps, input())).toEqual({ result: "refused", reason: "not_eligible" });
    expect(t.verifyOtp).not.toHaveBeenCalled();
    expect(t.links).toHaveLength(0);
  });
  it("internal / test_ accounts and a location-id mismatch are not eligible either", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mismatch = acct();
    mismatch.user.ghlLocationId = "LOC_OTHER";
    for (const [a, id] of [[acct({ accountType: "internal" }), input()], [acct({ contactId: "test_abc" }), input()], [mismatch, input({ identifier: { locationId: "LOC_ONE" } })]] as const) {
      const t = setup([a]);
      expect(await handleVerifyConfirm(t.deps, id)).toEqual({ result: "refused", reason: "not_eligible" });
      expect(t.links).toHaveLength(0);
    }
  });
  it("not_found and not_eligible are identical in body and side effects", async () => {
    const nf = setup([]);
    const nfBody = await handleVerifyConfirm(nf.deps, input({ identifier: { email: "ghost@example.test" } }));
    const ne = setup([acct({ status: "suspended" })]);
    const neBody = await handleVerifyConfirm(ne.deps, input());
    expect(JSON.stringify(neBody)).toBe(JSON.stringify(nfBody));
    expect(confirmRows(nf)).toHaveLength(1);
    expect(confirmRows(ne)).toHaveLength(1);
    expect(nf.verifyOtp).not.toHaveBeenCalled();
    expect(ne.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("attempt recording and rate limiting", () => {
  it("writes a confirm-kind attempt row before every outcome (success, wrong code, refusal)", async () => {
    for (const [accounts, otp] of [[[acct()], { status: "success" }], [[acct()], { status: "wrong", attemptsRemaining: 1 }], [[], { status: "success" }]] as const) {
      const t = setup([...accounts], [], [], otp as VerifyOtpResult);
      await handleVerifyConfirm(t.deps, input());
      expect(confirmRows(t)).toHaveLength(1);
      expect(confirmRows(t)[0]).toMatchObject({ kind: "confirm", discordUserId: D1 });
    }
  });
  it(`more than ${MAX_CONFIRMS_PER_DISCORD_ID} confirms per Discord id in an hour → rate_limited (even for an unknown email), and the row is still written`, async () => {
    const prior = Array.from({ length: MAX_CONFIRMS_PER_DISCORD_ID }, () => ({ kind: "confirm", discordUserId: D1, ghlAccountId: null, createdAt: new Date(NOW.getTime() - 60_000) }));
    const t = setup([], [], prior);
    expect(await handleVerifyConfirm(t.deps, input({ identifier: { email: "ghost@example.test" } }))).toEqual({ result: "refused", reason: "rate_limited" });
    expect(confirmRows(t)).toHaveLength(MAX_CONFIRMS_PER_DISCORD_ID + 1);
  });
  it("the Nth confirm still goes through; start-kind rows and old rows don't count", async () => {
    const mk = (over: Row) => Array.from({ length: 20 }, () => ({ kind: "confirm", discordUserId: D1, ghlAccountId: "A1", createdAt: new Date(NOW.getTime() - 60_000), ...over }));
    const t = setup([acct()], [], [...mk({ kind: "start" }), ...mk({ createdAt: new Date(NOW.getTime() - 2 * 3600_000) })]);
    expect((await handleVerifyConfirm(t.deps, input())).result).toBe("linked");
    const edge = setup([acct()], [], mk({}).slice(0, MAX_CONFIRMS_PER_DISCORD_ID - 1));
    expect((await handleVerifyConfirm(edge.deps, input())).result).toBe("linked");
  });
});
