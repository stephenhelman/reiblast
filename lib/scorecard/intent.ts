import { Prisma, type PrismaClient } from "@prisma/client";
import { SCORECARD_DEDUPE_PREFIX } from "@/lib/billing/intents/send";
import { denverDayOf } from "@/lib/billing/reports/denver";
import { TOOLS_URL } from "@/lib/constants";

export { SCORECARD_DEDUPE_PREFIX };

/** SCORECARD_INTENTS=live sends; anything else (including unset) records skipped_shadow and never sends. Independent of DUNNING_MODE. */
export function scorecardIntentsMode(env: Record<string, string | undefined> = process.env): "live" | "shadow" {
  return env.SCORECARD_INTENTS === "live" ? "live" : "shadow";
}

/** ISO 8601 week of the DENVER calendar day containing `now`, e.g. "2026-W46" (Monday-start; the year is the ISO week-year). */
export function isoWeekKey(now: Date): string {
  const [y, m, d] = denverDayOf(now).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // the Thursday of this ISO week decides the week-year
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const scorecardDedupeKey = (locationId: string, week: string) => `${SCORECARD_DEDUPE_PREFIX}${locationId}:${week}`;

/** The full emailed link: TOOLS_URL + /scorecard/view?t=<token> (the token is base64url + dots, so no extra encoding is needed). */
export const scorecardViewUrl = (token: string, base: string = TOOLS_URL): string => `${base}/scorecard/view?t=${encodeURIComponent(token)}`;

/** What the HQ workflow receives (modeled on the founder family: an action key + the HQ contact id). All values are strings. */
export type ScorecardIntentPayload = { intent: "scorecard_ready"; hqContactId: string; scorecardUrl: string };

export const buildScorecardPayload = (hqContactId: string, scorecardUrl: string): ScorecardIntentPayload => ({ intent: "scorecard_ready", hqContactId, scorecardUrl });

type Db = Pick<PrismaClient, "ghlIntent">;

/**
 * Sibling of enqueueFounderIntent: same outbox, `scorecard` pipeline, `scorecard:<locationId>:<ISO week>` key, own switch. Idempotent on
 * the key — a re-run or duplicate trigger in the same week records nothing new and never overwrites the stored link.
 */
export async function enqueueScorecardIntent(
  db: Db,
  p: { account: { id: string; contactId: string }; locationId: string; week: string; scorecardUrl: string; env?: Record<string, string | undefined> },
): Promise<{ id: string; created: boolean }> {
  const dedupeKey = scorecardDedupeKey(p.locationId, p.week);
  try {
    const row = await db.ghlIntent.create({
      data: {
        ghlAccountId: p.account.id,
        kind: "scorecard",
        pipeline: "scorecard",
        payload: buildScorecardPayload(p.account.contactId, p.scorecardUrl) as unknown as Prisma.InputJsonObject,
        dedupeKey,
        status: scorecardIntentsMode(p.env) === "live" ? "pending" : "skipped_shadow",
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const existing = await db.ghlIntent.findUnique({ where: { dedupeKey }, select: { id: true } });
    return { id: existing!.id, created: false };
  }
}
