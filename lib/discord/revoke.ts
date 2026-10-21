import type { PrismaClient } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { getBillingDb } from "@/lib/billing/db";
import { MAX_EFFECT_ATTEMPTS, backoffMs } from "@/lib/billing/state/effects";
import type { Reason } from "@/lib/billing/reason";

/**
 * Server → Discord bot revoke (docs/revoke-contract.md). Revoking = in ONE transaction delete the member's DiscordLink and upsert a
 * DiscordRevokeOutbox row (no FK to GhlAccount/User, so it outlives a member removal); delivery is attempted right after commit and
 * retried by the discord_outbox job on the effects.ts backoff ladder. Everything goes through getBillingDb().
 *
 * Logs carry fixed reason codes only — never a Discord id, an email, the bot URL or a secret (not even in a DB error's message).
 */
export type RevokeSource = "pause_webhook" | "member_removal" | "dunning_engine";
export type OutboxStatus = "pending" | "done" | "superseded" | "exhausted" | "config_error";

/** Every `lastReason` the outbox can hold: the bot's codes plus fixed local ones. */
export type RevokeReason =
  | Extract<Reason, "revoked" | "not_in_guild" | "not_holding_role" | "discord_unavailable" | "internal_error" | "auth_missing" | "auth_failed" | "bad_json" | "bad_request" | "server_misconfigured">
  | "ok_other" // result "ok" with a reason this server doesn't know — still delivered
  | "timeout"
  | "network_error"
  | "bad_response" // non-JSON body, or JSON that isn't { result, reason } (e.g. an HTML 502 from the host's proxy)
  | "unknown_response" // result "error" with a reason this server doesn't know — retried
  | "relinked"; // the member re-linked before delivery, so the revoke was dropped

export const REVOKE_TIMEOUT_MS = 10_000;
/** How long a claimed row stays invisible to other claimers (the request timeout plus margin for the DB writes around it). */
export const REVOKE_LEASE_MS = 2 * 60_000;

const OK_REASONS: readonly string[] = ["revoked", "not_in_guild", "not_holding_role"];
const RETRY_REASONS: readonly string[] = ["discord_unavailable", "internal_error"];
const PERMANENT_REASONS: readonly string[] = ["auth_missing", "auth_failed", "bad_json", "bad_request"];

export type RevokeDb = Pick<PrismaClient, "$transaction" | "discordRevokeOutbox" | "discordLink" | "ghlAccount">;
export type RevokeDeps = { db?: RevokeDb; fetch?: typeof fetch; now?: () => Date };

const resolveDb = async (deps: RevokeDeps): Promise<RevokeDb> => deps.db ?? ((await getBillingDb()) as RevokeDb);

/**
 * Delete the account's DiscordLink and queue the revoke, atomically. No link → no-op (null). A pending outbox row for the same Discord id
 * is left untouched (attempts/backoff preserved); a finished one is reset to pending with attempts 0.
 * Returns the outbox row id — the Discord id itself is deliberately not handed back to callers that could log it.
 */
export async function revokeDiscordForAccount(accountId: string, source: RevokeSource, deps: RevokeDeps = {}): Promise<{ outboxId: string } | null> {
  const db = await resolveDb(deps);
  const now = (deps.now ?? (() => new Date()))();
  return db.$transaction(async (tx) => {
    const link = await tx.discordLink.findUnique({ where: { ghlAccountId: accountId }, select: { discordUserId: true } });
    if (!link) return null;
    await tx.discordLink.delete({ where: { ghlAccountId: accountId } });
    const row = await tx.discordRevokeOutbox.upsert({
      where: { discordUserId: link.discordUserId },
      create: { discordUserId: link.discordUserId, source, nextAttemptAt: now },
      update: {},
      select: { id: true },
    });
    await tx.discordRevokeOutbox.updateMany({
      where: { id: row.id, status: { not: "pending" } },
      data: { status: "pending", attempts: 0, nextAttemptAt: now, lastReason: null, completedAt: null, source },
    });
    return { outboxId: row.id };
  });
}

type Verdict = { kind: "done" | "retry" | "config_error"; reason: RevokeReason };

async function send(fetchFn: typeof fetch, baseUrl: string, secret: string, discordUserId: string): Promise<Verdict> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reiblast-bot-secret": secret },
      body: JSON.stringify({ discordUserId }),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { kind: "retry", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error" };
  }
  // The HTTP status is never consulted (contract: always 200; a proxy's 502 simply fails the shape check below).
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "retry", reason: "bad_response" };
  }
  const b = body as { result?: unknown; reason?: unknown } | null;
  if (!b || typeof b !== "object" || typeof b.result !== "string" || typeof b.reason !== "string") return { kind: "retry", reason: "bad_response" };
  if (b.result === "ok") return { kind: "done", reason: OK_REASONS.includes(b.reason) ? (b.reason as RevokeReason) : "ok_other" };
  if (b.result !== "error") return { kind: "retry", reason: "bad_response" };
  if (PERMANENT_REASONS.includes(b.reason)) return { kind: "config_error", reason: b.reason as RevokeReason };
  if (RETRY_REASONS.includes(b.reason)) return { kind: "retry", reason: b.reason as RevokeReason };
  return { kind: "retry", reason: "unknown_response" };
}

export type DeliverOutcome = "done" | "superseded" | "retry" | "exhausted" | "config_error" | "skipped" | "error";

/**
 * One delivery attempt for an outbox row. Atomic lease claim first (only a pending, due row; the claimer pushes nextAttemptAt out by
 * REVOKE_LEASE_MS), then the re-link check (a DiscordLink for that Discord id again → superseded, nothing sent), then the POST.
 * Never throws and never logs more than a reason code. "skipped" = not pending / not due / another claimer holds the lease.
 */
export async function deliverRevoke(outboxId: string, deps: RevokeDeps = {}): Promise<DeliverOutcome> {
  try {
    const db = await resolveDb(deps);
    const now = (deps.now ?? (() => new Date()))();
    const row = await db.discordRevokeOutbox.findUnique({ where: { id: outboxId }, select: { discordUserId: true, status: true, attempts: true } });
    if (!row || row.status !== "pending") return "skipped";

    const claim = await db.discordRevokeOutbox.updateMany({
      where: { id: outboxId, status: "pending", nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + REVOKE_LEASE_MS) },
    });
    if (claim.count !== 1) return "skipped";

    const finish = (data: Record<string, unknown>) => db.discordRevokeOutbox.updateMany({ where: { id: outboxId, status: "pending" }, data });
    const attempts = row.attempts + 1;

    if (await db.discordLink.findUnique({ where: { discordUserId: row.discordUserId }, select: { id: true } })) {
      await finish({ status: "superseded", lastReason: "relinked", completedAt: now });
      console.log("[discord/revoke] outcome=superseded reason=relinked");
      return "superseded";
    }

    const url = process.env.DISCORD_BOT_URL;
    const secret = process.env.DISCORD_BOT_OUTBOUND_SECRET;
    const verdict: Verdict = url && secret ? await send(deps.fetch ?? fetch, url, secret, row.discordUserId) : { kind: "config_error", reason: "server_misconfigured" };

    let outcome: DeliverOutcome;
    if (verdict.kind === "done") {
      await finish({ status: "done", attempts, lastReason: verdict.reason, completedAt: now });
      outcome = "done";
    } else if (verdict.kind === "config_error") {
      await finish({ status: "config_error", attempts, lastReason: verdict.reason });
      outcome = "config_error";
    } else if (attempts >= MAX_EFFECT_ATTEMPTS) {
      await finish({ status: "exhausted", attempts, lastReason: verdict.reason });
      outcome = "exhausted";
    } else {
      await finish({ attempts, lastReason: verdict.reason, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) });
      outcome = "retry";
    }
    if (outcome === "config_error") console.error(`[discord/revoke] CONFIG ERROR reason=${verdict.reason} — revoke not sent, no retry`);
    else if (outcome === "exhausted") console.error(`[discord/revoke] EXHAUSTED after ${attempts} attempts reason=${verdict.reason}`);
    else console.log(`[discord/revoke] outcome=${outcome} reason=${verdict.reason}`);
    return outcome;
  } catch (err) {
    // err.message can embed query arguments (Discord ids) — log the error class/code only.
    console.error(`[discord/revoke] deliver failed reason=internal_error code=${(err as { code?: string })?.code ?? (err as Error)?.name ?? "unknown"}`);
    return "error";
  }
}

/**
 * Pause-route hook: revoke for the member's account, then deliver in the background. Fully contained — any failure is logged as a fixed
 * reason code and swallowed, so the caller's response can never change. No GhlAccount or no DiscordLink → no-op.
 */
export async function revokeDiscordOnPause(userId: string, deps: RevokeDeps = {}): Promise<void> {
  try {
    const db = await resolveDb(deps);
    const account = await db.ghlAccount.findUnique({ where: { userId }, select: { id: true } });
    if (!account) return;
    const queued = await revokeDiscordForAccount(account.id, "pause_webhook", { ...deps, db });
    if (queued) waitUntil(deliverRevoke(queued.outboxId, { ...deps, db }));
  } catch (err) {
    console.error(`[discord/revoke] pause hook failed reason=revoke_hook_failed code=${(err as { code?: string })?.code ?? (err as Error)?.name ?? "unknown"}`);
  }
}
