import type { RevokeDb } from "@/lib/discord/revoke";
import { MAX_EFFECT_ATTEMPTS } from "../state/effects";
import { deliverRevoke, type DeliverOutcome } from "@/lib/discord/revoke";
import type { JobFn } from "./types";

/**
 * Every-15-minutes Discord revoke outbox ("discord_outbox", triggered by a GHL scheduled workflow like the other jobs). Per run:
 *  1. Purge `done` / `superseded` rows finished more than 30 days ago.
 *  2. Re-arm `config_error` rows — only when DISCORD_BOT_URL and DISCORD_BOT_OUTBOUND_SECRET are both set — by putting them back to
 *     pending. The delivery attempt that follows is a real attempt (attempts + 1), so a still-broken config ends `exhausted` after
 *     MAX_EFFECT_ATTEMPTS, not in an endless loop.
 *  3. Deliver every due pending row (nextAttemptAt <= now) through deliverRevoke (lease, re-link check, contract mapping, backoff).
 * The summary holds numbers only — never a Discord id — and keeps stable field names so an alert can be built on it later:
 * delivered/retried/exhausted/config_error/superseded are outcomes of THIS run; standingExhausted/standingConfigError are the rows
 * currently sitting in those states (what an alert should watch). Dry-run writes nothing and reports what it would do.
 */
export const OUTBOX_PURGE_DAYS = 30;
const BATCH = 20;

type Counts = { delivered: number; retried: number; exhausted: number; config_error: number; superseded: number; skipped: number; errors: number; purged: number; rearmed: number };
type Cursor = { tried: string[]; counts: Counts; prepared: boolean };

const zero = (): Counts => ({ delivered: 0, retried: 0, exhausted: 0, config_error: 0, superseded: 0, skipped: 0, errors: 0, purged: 0, rearmed: 0 });
const OUTCOME_KEY: Record<DeliverOutcome, keyof Counts> = { done: "delivered", retry: "retried", exhausted: "exhausted", config_error: "config_error", superseded: "superseded", skipped: "skipped", error: "errors" };
const envReady = () => !!process.env.DISCORD_BOT_URL && !!process.env.DISCORD_BOT_OUTBOUND_SECRET;

export const runDiscordOutbox: JobFn = async (ctx) => {
  const db = ctx.db;
  const cutoff = new Date(ctx.now.getTime() - OUTBOX_PURGE_DAYS * 86_400_000);
  const rearmWhere = { status: "config_error", attempts: { lt: MAX_EFFECT_ATTEMPTS } };
  const purgeWhere = { status: { in: ["done", "superseded"] }, completedAt: { lt: cutoff } };

  if (!ctx.apply) {
    const [due, rearmable, purgeable] = await Promise.all([
      db.discordRevokeOutbox.count({ where: { status: "pending", nextAttemptAt: { lte: ctx.now } } }),
      envReady() ? db.discordRevokeOutbox.count({ where: rearmWhere }) : 0,
      db.discordRevokeOutbox.count({ where: purgeWhere }),
    ]);
    return { done: true, summary: { dryRun: true, due, rearmable, purgeable } };
  }

  const st = ctx.cursor as Cursor | null;
  const counts: Counts = { ...zero(), ...(st?.counts ?? {}) };
  const tried = new Set<string>(st?.tried ?? []);

  if (!st?.prepared) {
    counts.purged = (await db.discordRevokeOutbox.deleteMany({ where: purgeWhere })).count;
    if (envReady()) counts.rearmed = (await db.discordRevokeOutbox.updateMany({ where: rearmWhere, data: { status: "pending", nextAttemptAt: ctx.now } })).count;
  }

  for (;;) {
    const batch = await db.discordRevokeOutbox.findMany({
      where: { status: "pending", nextAttemptAt: { lte: ctx.now }, ...(tried.size ? { id: { notIn: [...tried] } } : {}) },
      orderBy: { nextAttemptAt: "asc" },
      take: BATCH,
      select: { id: true },
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      if (ctx.shouldYield()) return { done: false, cursor: { tried: [...tried], counts, prepared: true } satisfies Cursor, summary: { ...counts } };
      tried.add(row.id);
      counts[OUTCOME_KEY[await deliverRevoke(row.id, { db: db as unknown as RevokeDb })]]++;
    }
  }

  const [standingExhausted, standingConfigError] = await Promise.all([
    db.discordRevokeOutbox.count({ where: { status: "exhausted" } }),
    db.discordRevokeOutbox.count({ where: { status: "config_error" } }),
  ]);
  const summary = { ...counts, standingExhausted, standingConfigError };
  console.log(`[discord/outbox] ${JSON.stringify(summary)}`);
  return { done: true, summary };
};
