import { discordLaunch, discordTick, FOUNDERS_PROMO } from "@/lib/founderOffer/discordEvents";
import type { PromoHandler, PromoRegistry } from "./registry";

export const PROMO_REGISTRY: PromoRegistry = {
  [FOUNDERS_PROMO]: {
    discord_tick: discordTick,
    discord_launch: discordLaunch,
  },
};

export function findHandler(promo: unknown, event: unknown, registry: PromoRegistry = PROMO_REGISTRY): PromoHandler | null {
  if (typeof promo !== "string" || typeof event !== "string") return null;
  return Object.hasOwn(registry, promo) && Object.hasOwn(registry[promo], event) ? registry[promo][event] : null;
}
