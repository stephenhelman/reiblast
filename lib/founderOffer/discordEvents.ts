import { resolveChannel, type ChannelKey, type DiscordPayload } from "@/lib/discord/webhook";
import { chicagoRunKey, getPromoPhase } from "./phase";
import { buildLaunchPayload, buildTickPayload, embedLimitViolations, type Variation } from "./discordCopy";
import { getFounderSlotsLeft } from "./index";
import { founderUrls } from "./urls";
import { pickVariation, postOnce, previousSentVariation, type PromoPostDb } from "@/lib/promo/post";
import type { PromoHandler } from "@/lib/promo/registry";

export const FOUNDERS_PROMO = "founders-2026";

function launchRoleId(override?: string | null) {
  return override ?? process.env.DISCORD_REIBLAST_ROLE_ID?.trim() ?? null;
}

type Ctx = Parameters<PromoHandler>[0];

async function run(
  ctx: Ctx,
  channel: ChannelKey,
  runKey: string,
  choose: (db: PromoPostDb) => Promise<number>,
  build: (variation: number) => DiscordPayload,
) {
  const target = resolveChannel(channel);
  if (!target.ok) return { reason: target.reason, channel };
  if (ctx.dryRun) {
    const variation = await choose(ctx.db);
    const payload = build(variation);
    return { reason: "dry_run", channel, runKey, variation, payload, limitViolations: embedLimitViolations(payload) };
  }
  const outcome = await postOnce({
    db: ctx.db,
    promo: FOUNDERS_PROMO,
    runKey,
    channel,
    webhookUrl: target.url,
    chooseVariation: () => choose(ctx.db),
    build,
  });
  return { ...outcome, channel, runKey };
}

export const discordTick: PromoHandler = async (ctx) => {
  const phase = getPromoPhase(ctx.now);
  if (!phase.ok) return { reason: phase.reason };
  const slotsLeft = phase.phase === "open" ? await getFounderSlotsLeft() : 0;
  const urls = founderUrls();
  const choose = async (db: PromoPostDb) => pickVariation(await previousSentVariation(db, FOUNDERS_PROMO));
  return run(ctx, "promo", chicagoRunKey(ctx.now), choose, (variation) =>
    buildTickPayload({ phase: phase.phase, variation: variation as Variation, slotsLeft, urls }),
  );
};

export const discordLaunch: PromoHandler = async (ctx) => {
  const phase = getPromoPhase(ctx.now);
  if (!phase.ok) return { reason: phase.reason };
  const build = () => buildLaunchPayload({ urls: founderUrls(), roleId: launchRoleId() });
  // dryRun can preview the launch post before the window opens; it still says whether a real call would post.
  if (phase.phase !== "open") {
    if (!ctx.dryRun) return { reason: "launch_not_open" };
    const out = await run(ctx, "announcements", "launch", async () => 0, build);
    return { ...out, wouldPost: false, note: "launch_not_open" };
  }
  return run(ctx, "announcements", "launch", async () => 0, build);
};
