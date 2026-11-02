import { beforeEach, describe, expect, it } from "vitest";
import { handleFounderLink, MAX_LINKS_PER_MINUTE, NOT_VERIFIED_MESSAGE, parseFounderLinkBody } from "../linkEndpoint";
import { signFounderLink, verifyFounderLink } from "../linkToken";

const D1 = "111111111111111111";
const NOW = new Date("2026-10-29T01:00:00Z");
function makeDb(linked: Record<string, string>) {
  const attempts: any[] = [];
  return {
    attempts,
    discordLink: { findUnique: async ({ where }: any) => (linked[where.discordUserId] ? { ghlAccountId: linked[where.discordUserId] } : null) },
    founderVerifyAttempt: {
      create: async ({ data }: any) => void attempts.push(data),
      count: async ({ where }: any) => attempts.filter((a) => a.kind === where.kind && a.discordUserId === where.discordUserId && a.createdAt >= where.createdAt.gte).length,
    },
  };
}
beforeEach(() => {
  process.env.FOUNDERS_LINK_SECRET = "link-secret-for-tests-0123456789";
  process.env.NEXT_PUBLIC_APP_URL = "https://reiblast.app";
  delete process.env.FOUNDER_CLAIM_URL;
});

describe("parseFounderLinkBody", () => {
  it("needs a snowflake-shaped discordUserId", () => {
    expect(parseFounderLinkBody({ discordUserId: D1 })).toEqual({ discordUserId: D1 });
    expect(parseFounderLinkBody({ discordUserId: "12" })).toBeNull();
    expect(parseFounderLinkBody({})).toBeNull();
  });
});

describe("handleFounderLink", () => {
  it("no DiscordLink → not_verified with the #verify message and no attempt row", async () => {
    const db = makeDb({});
    expect(await handleFounderLink({ db, now: () => NOW }, { discordUserId: D1 })).toEqual({ result: "not_verified", reason: "not_verified", message: NOT_VERIFIED_MESSAGE });
    expect(db.attempts).toHaveLength(0);
  });
  it("linked → a URL whose token verifies to { ghlAccountId, discordUserId } (30 min)", async () => {
    const db = makeDb({ [D1]: "A1" });
    const out: any = await handleFounderLink({ db, now: () => NOW }, { discordUserId: D1 });
    expect(out.result).toBe("ok");
    expect(out.url.startsWith("https://reiblast.app/founders/claim?t=")).toBe(true);
    const token = decodeURIComponent(out.url.split("?t=")[1]);
    expect(await verifyFounderLink(token)).toEqual({ ghlAccountId: "A1", discordUserId: D1 });
    expect(db.attempts[0]).toMatchObject({ kind: "link", ghlAccountId: "A1", discordUserId: D1 });
  });
  it("no eligibility or window check: a link is minted regardless", async () => {
    expect(((await handleFounderLink({ db: makeDb({ [D1]: "A1" }), now: () => new Date("2030-01-01") }, { discordUserId: D1 })) as any).result).toBe("ok");
  });
  it("rate limit: 5 per minute per discordUserId, the 6th is refused; the window slides", async () => {
    const db = makeDb({ [D1]: "A1" });
    for (let i = 0; i < MAX_LINKS_PER_MINUTE; i++) expect(((await handleFounderLink({ db, now: () => NOW }, { discordUserId: D1 })) as any).result).toBe("ok");
    expect(await handleFounderLink({ db, now: () => NOW }, { discordUserId: D1 })).toEqual({ result: "refused", reason: "rate_limited" });
    expect(((await handleFounderLink({ db, now: () => new Date(NOW.getTime() + 61_000) }, { discordUserId: D1 })) as any).result).toBe("ok");
  });
});

describe("link token", () => {
  it("rejects garbage, a token signed with another secret, and an expired token", async () => {
    expect(await verifyFounderLink("nope")).toBeNull();
    const t = await signFounderLink({ ghlAccountId: "A1", discordUserId: D1 });
    process.env.FOUNDERS_LINK_SECRET = "a-different-secret-0123456789abcd";
    expect(await verifyFounderLink(t)).toBeNull();
    process.env.FOUNDERS_LINK_SECRET = "link-secret-for-tests-0123456789";
    expect(await verifyFounderLink(t)).not.toBeNull();
    const { SignJWT } = await import("jose");
    const old = await new SignJWT({ ghlAccountId: "A1", discordUserId: D1 }).setProtectedHeader({ alg: "HS256" }).setAudience("founders-link").setExpirationTime(Math.floor(Date.now() / 1000) - 10).sign(new TextEncoder().encode(process.env.FOUNDERS_LINK_SECRET));
    expect(await verifyFounderLink(old)).toBeNull();
  });
});
