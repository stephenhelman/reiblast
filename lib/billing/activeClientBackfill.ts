import type { PrismaClient } from "@prisma/client";

/**
 * Backfill for GhlAccount.activeClientSince: members who ALREADY have an opportunity in the Clients pipeline have been handed off, so
 * the engine must route their billing intents to Clients. Read-only GHL lookup (one GET per member), dry-run by default.
 * The orchestration is here (injected lookup, no I/O of its own) so it is unit-tested; the CLI is scripts/billing/backfill-active-client-since.ts.
 */
export type OpportunityLookup = { found: false } | { found: true; createdAt: Date | null };

/** Read-only: does this contact hold an opportunity in the pipeline? Throws on any API failure (never reads "error" as "none"). */
export async function lookupClientsOpportunity(contactId: string, env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): Promise<OpportunityLookup> {
  const key = env.GHL_HQ_API_KEY, loc = env.GHL_HQ_LOCATION_ID, pipeline = env.GHL_CLIENTS_PIPELINE_ID;
  if (!key || !loc || !pipeline) throw new Error("GHL_HQ_API_KEY / GHL_HQ_LOCATION_ID / GHL_CLIENTS_PIPELINE_ID must be set");
  const res = await fetchFn(
    `https://services.leadconnectorhq.com/opportunities/search?location_id=${encodeURIComponent(loc)}&pipeline_id=${encodeURIComponent(pipeline)}&contact_id=${encodeURIComponent(contactId)}`,
    { headers: { Authorization: `Bearer ${key}`, Version: "2021-07-28", Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`GHL opportunity search failed: HTTP ${res.status}`);
  const j = (await res.json()) as { opportunities?: { createdAt?: unknown; dateAdded?: unknown }[] };
  const opp = j.opportunities?.[0];
  if (!opp) return { found: false };
  const raw = typeof opp.createdAt === "string" ? opp.createdAt : typeof opp.dateAdded === "string" ? opp.dateAdded : null;
  const d = raw ? new Date(raw) : null;
  return { found: true, createdAt: d && !Number.isNaN(d.getTime()) ? d : null };
}

export type BackfillReport = {
  members: number;
  /** GHL GET calls this run makes (or would make): one per member without activeClientSince. */
  calls: number;
  withCard: { accountId: string; contactId: string; billingState: string | null; since: Date }[];
  withoutCard: number;
  errors: { accountId: string; contactId: string; error: string }[];
  applied: number;
};

type Db = Pick<PrismaClient, "ghlAccount">;

export async function pendingMembers(db: Db) {
  return db.ghlAccount.findMany({ where: { accountType: "member", activeClientSince: null }, select: { id: true, contactId: true, billingState: true }, orderBy: { id: "asc" } });
}

/** Look every pending member up (sequentially, `pauseMs` apart), then — only with `apply` — set activeClientSince for the ones with a card. */
export async function runActiveClientBackfill(
  db: Db,
  opts: { apply: boolean; lookup: (contactId: string) => Promise<OpportunityLookup>; now?: Date; pauseMs?: number; sleep?: (ms: number) => Promise<void>; onProgress?: (done: number, total: number) => void },
): Promise<BackfillReport> {
  const members = await pendingMembers(db);
  const report: BackfillReport = { members: members.length, calls: members.length, withCard: [], withoutCard: 0, errors: [], applied: 0 };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let done = 0;
  for (const m of members) {
    try {
      const r = await opts.lookup(m.contactId);
      if (r.found) report.withCard.push({ accountId: m.id, contactId: m.contactId, billingState: m.billingState, since: r.createdAt ?? opts.now ?? new Date() });
      else report.withoutCard++;
    } catch (e) {
      report.errors.push({ accountId: m.id, contactId: m.contactId, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
    done++;
    opts.onProgress?.(done, members.length);
    if (opts.pauseMs && done < members.length) await sleep(opts.pauseMs);
  }
  if (opts.apply) {
    for (const w of report.withCard) {
      // Guarded: never overwrites a handoff that happened (or a concurrent backfill) in the meantime.
      const r = await db.ghlAccount.updateMany({ where: { id: w.accountId, activeClientSince: null }, data: { activeClientSince: w.since } });
      report.applied += r.count;
    }
  }
  return report;
}
