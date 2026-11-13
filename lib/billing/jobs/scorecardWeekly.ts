import { sendPendingIntents } from "../intents/send";
import { activeMemberLocationIds } from "@/lib/scorecard/access";
import { enqueueScorecardIntent, isoWeekKey, scorecardDedupeKey, scorecardIntentsMode, scorecardViewUrl } from "@/lib/scorecard/intent";
import { getScorecardSecret, signScorecardToken } from "@/lib/scorecard/token";
import type { JobFn } from "./types";

/**
 * scorecard_weekly: for every MEMBER whose CampaignStats changed in the last 7 days (lastEventAt) and who passes the view page's active
 * check (lib/scorecard/access.ts), mint a 14-day scorecard token and enqueue ONE `scorecard_ready` GhlIntent for the week
 * (`scorecard:<locationId>:<ISO week>`, payload { intent, hqContactId, scorecardUrl } with the full TOOLS_URL link). Triggered Mondays by a
 * GHL scheduled workflow; the ISO-week dedupe key makes any extra trigger the same week (or a late catch-up) a no-op, so there is no
 * day-of-week guard. When SCORECARD_INTENTS=live each chunk's new rows are also sent right away (rows that fail stay pending/failed
 * and are retried by the replay job); otherwise they are recorded skipped_shadow and nothing leaves the server.
 * Resumable: the cursor is the last locationId processed plus running counts; the job yields when the time budget is nearly spent.
 */
export const ACTIVITY_WINDOW_DAYS = 7;
export const CHUNK = 8; // ≤ 8 sends × 1.5s pause ≈ 12s per chunk, inside the 6s yield margin + 60s function cap

type Counts = { candidates: number; enqueued: number; alreadyQueued: number; skippedNotMember: number; skippedInactive: number; sent: number; sendFailed: number };
type Cursor = { after: string | null; counts: Counts };
const zero = (): Counts => ({ candidates: 0, enqueued: 0, alreadyQueued: 0, skippedNotMember: 0, skippedInactive: 0, sent: 0, sendFailed: 0 });

export const runScorecardWeekly: JobFn = async (ctx) => {
  const db = ctx.db;
  const env = process.env;
  const st = ctx.cursor as Cursor | null;
  const counts: Counts = { ...zero(), ...(st?.counts ?? {}) };
  let after = st?.after ?? null;
  const since = new Date(ctx.now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000);
  const week = isoWeekKey(ctx.now);
  const live = scorecardIntentsMode(env) === "live";
  const summary = () => ({ week, mode: live ? "live" : "shadow", dryRun: !ctx.apply, ...counts });

  // Fail loudly (JobRun.lastError → Health) on a missing/bad SCORECARD_TOKEN_SECRET instead of quietly enqueueing nothing.
  if (ctx.apply) getScorecardSecret(env);

  for (;;) {
    const groups = await db.campaignStats.groupBy({
      by: ["locationId"],
      where: { lastEventAt: { gte: since }, ...(after ? { locationId: { gt: after } } : {}) },
      orderBy: { locationId: "asc" },
      take: CHUNK,
    });
    if (groups.length === 0) return { done: true, summary: summary() };
    const locationIds = groups.map((g) => g.locationId);
    counts.candidates += locationIds.length;

    const accounts = await db.ghlAccount.findMany({ where: { locationId: { in: locationIds }, accountType: "member" }, select: { id: true, contactId: true, locationId: true } });
    const memberByLoc = new Map(accounts.flatMap((a) => (a.locationId ? [[a.locationId, a] as const] : [])));
    const active = await activeMemberLocationIds(db, locationIds);
    const existing = new Set((await db.ghlIntent.findMany({ where: { dedupeKey: { in: locationIds.map((l) => scorecardDedupeKey(l, week)) } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey));

    const newIds: string[] = [];
    for (const loc of locationIds) {
      const account = memberByLoc.get(loc);
      if (!account || !account.contactId) { counts.skippedNotMember++; continue; }
      if (!active.has(loc)) { counts.skippedInactive++; continue; }
      if (existing.has(scorecardDedupeKey(loc, week))) { counts.alreadyQueued++; continue; }
      if (!ctx.apply) { counts.enqueued++; continue; }
      const url = scorecardViewUrl(await signScorecardToken(loc, env, ctx.now));
      const r = await enqueueScorecardIntent(db, { account: { id: account.id, contactId: account.contactId }, locationId: loc, week, scorecardUrl: url, env });
      if (r.created) { counts.enqueued++; newIds.push(r.id); } else counts.alreadyQueued++;
    }

    if (live && newIds.length) {
      const out = await sendPendingIntents(db, { onlyIds: newIds });
      counts.sent += out.sent;
      counts.sendFailed += out.failed;
    }

    after = locationIds[locationIds.length - 1];
    if (groups.length < CHUNK) return { done: true, summary: summary() };
    if (ctx.shouldYield()) return { done: false, cursor: { after, counts }, summary: summary() };
  }
};
