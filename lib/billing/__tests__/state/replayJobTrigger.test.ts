import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../intents/send", () => ({ sendPendingIntents: vi.fn(async () => ({ sent: 0, failed: 0 })) }));
vi.mock("../../state/effects", () => ({ retrySideEffects: vi.fn(async () => ({ attempted: 0, succeeded: 0, stillFailing: 0, exhausted: 0, superseded: 0 })) }));

import { runReplay } from "../../jobs/replay";
import { PAYMENT_SOURCE, REPLAYABLE_SOURCES, processPaymentEvent, replayableWhere } from "../../processPaymentEvent";
import { OP_INVOICE_SOURCE } from "@/lib/founderOffer/opInvoice";
import { processGhlEvent } from "../../events/process";

/** Minimal `where` matcher covering what replayableWhere uses: equality, {in}, {notIn}, {lt}. */
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return cond.in.includes(v);
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

  it("replayableWhere is a whitelist, so job_trigger is excluded even when unprocessed", () => {
    expect(REPLAYABLE_SOURCES).not.toContain("job_trigger");
    const where = replayableWhere(new Date("2026-09-27T00:00:00Z")) as any;
    expect(where.source).toEqual({ in: [...REPLAYABLE_SOURCES] });
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

describe("payment replay is restricted to source = 'payment' everywhere", () => {
  it("the whitelist is exactly the sources that have their own processor, and pins the OP source name", () => {
    expect([...REPLAYABLE_SOURCES].sort()).toEqual(["invoice", "op_invoice", "payment", "stage_change"]);
    expect(REPLAYABLE_SOURCES).toContain(OP_INVOICE_SOURCE);
    expect(PAYMENT_SOURCE).toBe("payment");
  });

  it("review records and any unknown source are excluded from replay and no-op if dispatched (even with attempts/lastError set)", async () => {
    const { processGhlEvent } = await import("../../events/process");
    const where = replayableWhere(new Date("2026-10-30T00:00:00Z")) as any;
    const old = new Date("2026-10-01T00:00:00Z");
    for (const source of ["stage_change_unmapped", "client_handoff_review", "job_trigger", "some_future_source"]) {
      expect(matches({ source, processedAt: null, attempts: 0, receivedAt: old }, where)).toBe(false);
      expect(await processGhlEvent("x", source, {} as never)).toBe("already_processed");
    }
    for (const source of REPLAYABLE_SOURCES) expect(matches({ source, processedAt: null, attempts: 0, receivedAt: old }, where)).toBe(true);
  });

  it("processPaymentEvent itself refuses a non-payment row: no fetch, no attempts/lastError written", async () => {
    const writes: unknown[] = [];
    for (const source of ["stage_change_unmapped", "client_handoff_review", "stage_change", "some_future_source"]) {
      const db: any = {
        ghlEvent: {
          findUnique: async () => ({ id: "e1", source, externalId: "HQCONTACT00001", processedAt: null, attempts: 0 }),
          update: async (a: unknown) => { writes.push(a); },
          findMany: async () => { throw new Error("must not look for pending events"); },
        },
      };
      expect(await processPaymentEvent("e1", { db })).toBe("already_processed"); // would otherwise attempt GET /payments/transactions/<id> → 422
    }
    expect(writes).toEqual([]);
  });

  it("the post-success pending-event retry only ever selects source = 'payment'", async () => {
    const { retryPendingEvents } = await import("../../processPaymentEvent");
    let seen: any = null;
    const db: any = { ghlEvent: { findMany: async (a: any) => { seen = a; return []; } } };
    await retryPendingEvents(db, "ev0");
    expect(seen.where.source).toBe("payment");
  });
});
