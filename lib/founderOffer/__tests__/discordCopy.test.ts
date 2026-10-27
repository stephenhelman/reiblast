import { describe, expect, it } from "vitest";
import { buildLaunchPayload, buildTickPayload, embedLimitViolations, FOOTER_TEXT, VARIATIONS } from "../discordCopy";
import type { DiscordAssetKey } from "../discordAssets";

const urls = { signup: "https://x.test/founders", claim: "https://x.test/founders/claim" };
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
      expect(pre).not.toContain(urls.claim);
      expect(pre).toContain(urls.signup);
      expect(pre).toContain("Wed, Oct 28 at 7 PM CT");
      const open = JSON.stringify(buildTickPayload({ phase: "open", variation: v, slotsLeft: 7, urls }));
      expect(open).toContain(urls.claim);
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
