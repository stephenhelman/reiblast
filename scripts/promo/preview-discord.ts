/**
 * Preview the founder-promo Discord posts in YOUR TEST SERVER before anything goes live. No DB access. Uses the same copy
 * builders and send helper as app/api/webhooks/ghl-promo.
 *
 * Reads ONLY DISCORD_PROMO_WEBHOOKS_TEST (JSON: {"promo": "...", "announcements": "...", "ops": "..."}) from .env.local/.env or the
 * shell. It never reads DISCORD_PROMO_WEBHOOKS. Without --send nothing is posted: the payload(s) and target channel key are printed.
 * With --send and no TEST var, it refuses.
 *
 *   npx tsx scripts/promo/preview-discord.ts                               # print all 4 pre-launch payloads
 *   npx tsx scripts/promo/preview-discord.ts --phase open --slots 7 --variation 2
 *   npx tsx scripts/promo/preview-discord.ts --phase pre --send            # post all 4 pre-launch posts, 1.5s apart
 *   npx tsx scripts/promo/preview-discord.ts --phase launch --role-id 123456789012345678 --send
 *
 * Flags: --phase pre|open|launch (default pre) · --variation 1|2|3|4|all (default all; ignored for launch)
 *        --slots <n> (default 10; open only) · --send · --role-id <id> (overrides DISCORD_REIBLAST_ROLE_ID for the launch ping)
 */
import path from "node:path";
import dotenv from "dotenv";
import { resolveChannelFrom, sendDiscordWebhook, type ChannelKey, type DiscordPayload } from "../../lib/discord/webhook";
import { buildLaunchPayload, buildTickPayload, embedLimitViolations, VARIATIONS, type Variation } from "../../lib/founderOffer/discordCopy";
import { founderUrls } from "../../lib/founderOffer/urls";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local"), quiet: true });
dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const phase = flag("phase") ?? "pre";
const variationArg = flag("variation") ?? "all";
const slots = Number(flag("slots") ?? "10");
const send = args.includes("--send");
const roleId = flag("role-id") ?? process.env.DISCORD_REIBLAST_ROLE_ID?.trim() ?? null;

if (!["pre", "open", "launch"].includes(phase)) fail(`--phase must be pre | open | launch (got "${phase}")`);
if (variationArg !== "all" && !VARIATIONS.includes(Number(variationArg) as Variation)) fail("--variation must be 1|2|3|4|all");
if (!Number.isInteger(slots) || slots < 0) fail("--slots must be a non-negative integer");

const testMap = process.env.DISCORD_PROMO_WEBHOOKS_TEST;
if (send && !testMap?.trim()) fail("DISCORD_PROMO_WEBHOOKS_TEST is not set — refusing to send.");

const urls = founderUrls();
const channel: ChannelKey = phase === "launch" ? "announcements" : "promo";
const posts: { label: string; payload: DiscordPayload }[] =
  phase === "launch"
    ? [{ label: "launch", payload: buildLaunchPayload({ urls, roleId }) }]
    : (variationArg === "all" ? [...VARIATIONS] : [Number(variationArg) as Variation]).map((variation) => ({
        label: `${phase} v${variation}`,
        payload: buildTickPayload({ phase: phase === "open" ? "open" : "pre", variation, slotsLeft: slots, urls }),
      }));

async function main() {
  if (!send) {
    for (const p of posts) {
      console.log(`--- ${p.label} → channel "${channel}" ---`);
      console.log(JSON.stringify(p.payload, null, 2));
      const bad = embedLimitViolations(p.payload);
      if (bad.length) console.warn(`LIMIT VIOLATIONS: ${bad.join(", ")}`);
    }
    console.log("\n(dry: nothing sent — add --send to post to the TEST webhooks)");
    return;
  }
  const target = resolveChannelFrom(testMap, channel);
  if (!target.ok) fail(`Cannot send: ${target.reason} for channel "${channel}" in DISCORD_PROMO_WEBHOOKS_TEST`);
  for (let i = 0; i < posts.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    const res = await sendDiscordWebhook(target.url, posts[i].payload);
    console.log(
      res.ok ? `sent    ${posts[i].label} → "${channel}" message ${res.messageId}` : `FAILED  ${posts[i].label} → "${channel}" ${res.error}`,
    );
  }
}

main().catch(() => fail("preview failed unexpectedly"));
