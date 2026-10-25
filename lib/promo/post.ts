import { prisma } from "@/lib/prisma";
import { sendDiscordWebhook, sendOpsAlert, type ChannelKey, type DiscordPayload, type SendResult } from "@/lib/discord/webhook";

// Dedupe + send for server-driven promo posts. The row is inserted BEFORE sending, as status "failed" / error "unsent", so a
// crash between insert and send leaves a retryable row rather than a silent gap. Sent -> skip. Failed -> one retry (update it).

export interface PromoPostRow {
  id: string;
  promo: string;
  runKey: string;
  variation: number;
  status: string;
  discordMessageId: string | null;
  error: string | null;
  createdAt: Date;
}

/** The slice of Prisma this module uses, so tests can pass an in-memory stand-in. */
export interface PromoPostDb {
  promoPost: {
    findUnique(args: { where: { promo_runKey: { promo: string; runKey: string } } }): Promise<PromoPostRow | null>;
    findFirst(args: {
      where: { promo: string; status: string; runKey?: { not: string } };
      orderBy: { createdAt: "desc" };
    }): Promise<PromoPostRow | null>;
    create(args: { data: { promo: string; runKey: string; variation: number; status: string; error: string } }): Promise<PromoPostRow>;
    update(args: {
      where: { id: string };
      data: { status: string; discordMessageId?: string | null; error?: string | null };
    }): Promise<PromoPostRow>;
  };
}

export const defaultPromoDb = (): PromoPostDb => prisma as unknown as PromoPostDb;

/** Random 1–4, never equal to the previous sent variation (null = no previous). `rand` is injectable for tests. */
export function pickVariation(previous: number | null, rand: () => number = Math.random): 1 | 2 | 3 | 4 {
  const pool = ([1, 2, 3, 4] as const).filter((v) => v !== previous);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

export async function previousSentVariation(db: PromoPostDb, promo: string): Promise<number | null> {
  const row = await db.promoPost.findFirst({
    where: { promo, status: "sent", runKey: { not: "launch" } },
    orderBy: { createdAt: "desc" },
  });
  return row?.variation ?? null;
}

export type PostOutcome =
  | { reason: "posted"; messageId: string }
  | { reason: "duplicate" }
  | { reason: "send_failed"; error: string };

const isUniqueViolation = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

/**
 * Claim the (promo, runKey) slot, send, record the result. `build(variation)` is called once the variation is known — for a
 * retry that is the failed row's own variation, so the retry posts what the first attempt would have.
 */
export async function postOnce(opts: {
  db: PromoPostDb;
  promo: string;
  runKey: string;
  channel: ChannelKey;
  webhookUrl: string;
  chooseVariation: () => Promise<number>;
  build: (variation: number) => DiscordPayload;
  send?: (url: string, payload: DiscordPayload) => Promise<SendResult>;
  alert?: (text: string) => Promise<void>;
}): Promise<PostOutcome> {
  const { db, promo, runKey, send = sendDiscordWebhook, alert = (t) => sendOpsAlert(t) } = opts;
  const key = { promo_runKey: { promo, runKey } };

  let row = await db.promoPost.findUnique({ where: key });
  if (row?.status === "sent") return { reason: "duplicate" };
  if (!row) {
    const variation = await opts.chooseVariation();
    try {
      row = await db.promoPost.create({ data: { promo, runKey, variation, status: "failed", error: "unsent" } });
    } catch (err) {
      if (isUniqueViolation(err)) return { reason: "duplicate" }; // a concurrent request won the insert
      throw err;
    }
  }

  const result = await send(opts.webhookUrl, opts.build(row.variation));
  if (result.ok) {
    await db.promoPost.update({ where: { id: row.id }, data: { status: "sent", discordMessageId: result.messageId, error: null } });
    return { reason: "posted", messageId: result.messageId };
  }
  await db.promoPost.update({ where: { id: row.id }, data: { status: "failed", error: result.error } });
  await alert(`Promo post failed: ${promo} ${runKey} (${result.error})`).catch(() => {});
  return { reason: "send_failed", error: result.error };
}
