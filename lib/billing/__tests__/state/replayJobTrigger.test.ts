import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../intents/send", () => ({ sendPendingIntents: vi.fn(async () => ({ sent: 0, failed: 0 })) }));

import { runReplay } from "../../jobs/replay";
import { NON_REPLAYABLE_SOURCES, replayableWhere } from "../../processPaymentEvent";
import { processGhlEvent } from "../../events/process";

/** Minimal `where` matcher covering what replayableWhere uses: equality, {notIn}, {lt}. */
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("notIn" in cond) return !cond.notIn.includes(v);
      if ("lt" in cond) return v < cond.lt;
      return true;
    }
    return v === cond;
  });
}

/**
 * job_trigger rows (app/api/webhooks/ghl/jobs/route.ts) are a trigger-attempt log, not a webhook to reprocess — nothing
 * ever "processes" them, so they must never be picked up by the replay job. Belt and suspenders: processedAt is set at
 * insert (excludes it from replayableWhere on its own), AND replayableWhere/processGhlEvent both exclude the source by
 * name, so even a row that somehow ended up with processedAt: null is still never replayed.
 */
describe("job_trigger rows are never replayed", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("NON_REPLAYABLE_SOURCES includes job_trigger, and replayableWhere excludes it even when unprocessed", () => {
    expect(NON_REPLAYABLE_SOURCES).toContain("job_trigger");
    const where = replayableWhere(new Date("2026-09-27T00:00:00Z")) as any;
    expect(where.source).toEqual({ notIn: [...NON_REPLAYABLE_SOURCES] });
  });

  it("processGhlEvent is a no-op for a job_trigger row — never routed to processPaymentEvent, never touches attempts/lastError", async () => {
    const calls: string[] = [];
    const db: any = {
      ghlEvent: {
        findUnique: async () => { calls.push("findUnique"); return { id: "ev1", source: "job_trigger" }; },
        update: async () => { calls.push("update"); throw new Error("job_trigger row must never be written to by an event processor"); },
      },
    };
    const result = await processGhlEvent("ev1", "job_trigger", db);
    expect(result).toBe("already_processed");
    expect(calls).toEqual([]); // never even looked at the row
  });

  it("runReplay's own query never returns a job_trigger row, even when it's old, unprocessed, and would otherwise be eligible", async () => {
    const jobTriggerRow = { id: "jt1", source: "job_trigger", receivedAt: new Date("2020-01-01"), attempts: 0, processedAt: null, lastError: null };
    const rows = [jobTriggerRow];
    const findMany = vi.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)));
    const db: any = { ghlEvent: { findMany } };
    const ctx = { db, apply: true, cursor: null, now: new Date("2026-09-27T00:00:00Z"), shouldYield: () => false };

    const outcome = await runReplay(ctx as any);

    expect(outcome).toMatchObject({ done: true, summary: { considered: 0, processed: 0, failed: 0, other: 0 } });
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(rows.filter((r) => matches(r, where))).toEqual([]); // the job_trigger row never made it into a batch
  });
});
