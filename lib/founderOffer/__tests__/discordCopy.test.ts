import { afterEach, describe, expect, it } from "vitest";
import { founderUrls } from "../urls";
import { buildLaunchPayload, buildTickPayload, embedLimitViolations, FOOTER_TEXT, VARIATIONS } from "../discordCopy";
import type { DiscordAssetKey } from "../discordAssets";

const urls = { signup: "https://x.test/founders", claimCta: "https://discord.com/channels/1/2" };
const ASSETS: Record<DiscordAssetKey, string> = {
  offerPrelaunch: "https://img.test/a.png", offerClaimsOpen: "https://img.test/b.png", whatsInside: "https://img.test/c.png",
  reisite: "https://img.test/d.png", googleYou: "https://img.test/e.png", launch: "https://img.test/f.png",
};
const BLANK = Object.fromEntries(Object.keys(ASSETS).map((k) => [k, "PLACEHOLDER"])) as Record<DiscordAssetKey, string>;
const ROLE = "123456789012345678";

describe("tick copy", () => {
  for (const phase of ["pre", "open"] as const) {
    for (const variation of VARIATIONS) {
      it(`${phase} v${variation} is within Discord limits and matches snapshot`, () => {
        const p = buildTickPayload({ phase, variation, slotsLeft: 7, urls, assets: ASSETS });
        expect(embedLimitViolations(p)).toEqual([]);
        expect(p.username).toBe("REIblast");
        expect(p.embeds![0].color).toBe(16107586);
        expect(p.content).toBeUndefined();
        expect(p).toMatchSnapshot();
      });
    }
  }
  it("pre has no claim link; open has claim + signup links and the slots line", () => {
    for (const v of VARIATIONS) {
      const pre = JSON.stringify(buildTickPayload({ phase: "pre", variation: v, slotsLeft: 7, urls }));
      expect(pre).not.toContain(urls.claimCta);
      expect(pre).toContain(urls.signup);
      expect(pre).toContain("Wed, Oct 28 at 7 PM CT");
      const open = JSON.stringify(buildTickPayload({ phase: "open", variation: v, slotsLeft: 7, urls }));
      expect(open).toContain(urls.claimCta);
      expect(open).toContain("**7 of 10**");
      expect(open).not.toContain("claims open **Wed");
    }
  });
  it("variation 1 swaps image by phase; footer only where specified", () => {
    expect(buildTickPayload({ phase: "pre", variation: 1, slotsLeft: 10, urls, assets: ASSETS }).embeds![0].image?.url).toBe(ASSETS.offerPrelaunch);
    expect(buildTickPayload({ phase: "open", variation: 1, slotsLeft: 10, urls, assets: ASSETS }).embeds![0].image?.url).toBe(ASSETS.offerClaimsOpen);
    const footers = VARIATIONS.map((v) => buildTickPayload({ phase: "pre", variation: v, slotsLeft: 10, urls }).embeds![0].footer?.text);
    expect(footers).toEqual([FOOTER_TEXT, undefined, FOOTER_TEXT, undefined]);
  });
  it("omits the image for placeholder / empty / non-https assets", () => {
    for (const v of VARIATIONS) {
      expect(buildTickPayload({ phase: "pre", variation: v, slotsLeft: 10, urls, assets: BLANK }).embeds![0].image).toBeUndefined();
    }
    const empty = { ...ASSETS, whatsInside: "" };
    expect(buildTickPayload({ phase: "pre", variation: 2, slotsLeft: 10, urls, assets: empty }).embeds![0].image).toBeUndefined();
  });
});

describe("claim CTA", () => {
  it("claims-open rotation: every variation points the title and CTA at claimCta and says to press Claim my spot", () => {
    for (const v of VARIATIONS) {
      const e = buildTickPayload({ phase: "open", variation: v, slotsLeft: 7, urls }).embeds![0];
      const json = JSON.stringify(e);
      expect(json).toContain(urls.claimCta);
      expect(json).toContain("Head to #founders-claim and press **Claim my spot**.");
      expect(json).not.toContain("/founders/claim");
      if (v === 1) expect(e.url).toBe(urls.claimCta);
    }
    const v1 = JSON.stringify(buildTickPayload({ phase: "open", variation: 1, slotsLeft: 7, urls }));
    expect(v1).toContain(`[Members: claim your slot in #founders-claim](${urls.claimCta})`);
  });
  it("launch: title url and CTA use claimCta; How It Works is the new copy", () => {
    const e = buildLaunchPayload({ urls, roleId: null, assets: ASSETS }).embeds![0];
    expect(e.url).toBe(urls.claimCta);
    const how = e.fields!.find((f) => f.name === "How It Works")!;
    expect(how.value).toBe(
      "Head to #founders-claim and press **Claim my spot**. You'll get your personal link. Enter the code we text you and your slot is reserved. " +
        "First member to claim gets REIsite + REIkit free; everyone after gets a $100 invoice, and your slot locks once it's paid. Unpaid invoices are released after 24 hours.",
    );
    expect(e.fields!.some((f) => f.value === `[Go to #founders-claim](${urls.claimCta})`)).toBe(true);
    expect(JSON.stringify(e)).not.toContain("Claim your founder slot");
  });
});

describe("founderUrls", () => {
  const keep = { ...process.env };
  afterEach(() => { process.env = { ...keep }; });
  it("claimCta uses FOUNDER_CLAIM_CTA_URL when set, else falls back to the claim URL; claim itself never changes", () => {
    process.env.FOUNDER_CLAIM_URL = "https://site.test/founders/claim";
    delete process.env.FOUNDER_CLAIM_CTA_URL;
    expect(founderUrls()).toMatchObject({ claim: "https://site.test/founders/claim", claimCta: "https://site.test/founders/claim" });
    process.env.FOUNDER_CLAIM_CTA_URL = " https://discord.com/channels/1/2 ";
    expect(founderUrls()).toMatchObject({ claim: "https://site.test/founders/claim", claimCta: "https://discord.com/channels/1/2" });
  });
  it("the personal link base (handleFounderLink) still uses FOUNDER_CLAIM_URL, not the CTA url", async () => {
    process.env.FOUNDER_CLAIM_URL = "https://site.test/founders/claim";
    process.env.FOUNDER_CLAIM_CTA_URL = "https://discord.com/channels/1/2";
    const { handleFounderLink } = await import("../linkEndpoint");
    const db: any = { discordLink: { findUnique: async () => ({ ghlAccountId: "A1" }) }, founderVerifyAttempt: { create: async () => {}, count: async () => 1 } };
    const out: any = await handleFounderLink({ db, sign: async () => "TOK" }, { discordUserId: "111111111111111111" });
    expect(out.url).toBe("https://site.test/founders/claim?t=TOK");
  });
});

describe("launch copy", () => {
  it("pings the role with allowed_mentions when the id is valid", () => {
    const p = buildLaunchPayload({ urls, roleId: ROLE, assets: ASSETS });
    expect(p.content).toBe(`<@&${ROLE}> Founder claims are open!`);
    expect(p.allowed_mentions).toEqual({ roles: [ROLE] });
    expect(embedLimitViolations(p)).toEqual([]);
    expect(p).toMatchSnapshot();
  });
  it("omits mention and allowed_mentions when the role id is missing or malformed", () => {
    for (const roleId of [undefined, null, "", "not-an-id"]) {
      const p = buildLaunchPayload({ urls, roleId, assets: ASSETS });
      expect(p.content).toBeUndefined();
      expect(p.allowed_mentions).toBeUndefined();
    }
  });
  it("omits a missing launch image and still builds", () => {
    expect(buildLaunchPayload({ urls, roleId: null, assets: BLANK }).embeds![0].image).toBeUndefined();
  });
});
