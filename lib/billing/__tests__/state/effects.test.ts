import { beforeEach, describe, expect, it, vi } from "vitest";
import { dueForRetry, executeEffects, getFailedSideEffects, MAX_EFFECT_ATTEMPTS, retrySideEffects, type SideEffectResult } from "../../state/effects";

function makeDb(decisions: Record<string, any>[], accounts: Record<string, any>[]) {
  return {
    dunningDecision: {
      findMany: async ({ where }: any) => decisions.filter((d) => d.mode === where.mode).sort((a, b) => b.createdAt - a.createdAt),
      findFirst: async ({ where }: any) => {
        const f = decisions.filter((d) => d.ghlAccountId === where.ghlAccountId && d.mode === where.mode);
        f.sort((a, b) => b.eventAt - a.eventAt || b.createdAt - a.createdAt);
        return f[0] ?? null;
      },
      update: async ({ where, data }: any) => Object.assign(decisions.find((d) => d.id === where.id)!, data),
    },
    ghlAccount: {
      findUnique: async ({ where }: any) => accounts.find((a) => a.id === where.id) ?? null,
    },
  };
}

const decision = (over: Record<string, any> = {}): Record<string, any> => ({ id: "d1", ghlAccountId: "a1", mode: "live", eventAt: new Date("2026-09-20"), createdAt: new Date("2026-09-20"), sideEffects: [] as SideEffectResult[], ...over });

describe("dueForRetry", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  it("not due: already executed", () => expect(dueForRetry({ type: "saas_pause", executedAt: "x" }, now)).toBe(false));
  it("not due: superseded", () => expect(dueForRetry({ type: "saas_pause", error: "e", superseded: true }, now)).toBe(false));
  it("not due: exhausted", () => expect(dueForRetry({ type: "saas_pause", error: "e", exhausted: true }, now)).toBe(false));
  it("not due: never attempted (no error at all — that's executeEffects' job, not retry's)", () => expect(dueForRetry({ type: "saas_pause" }, now)).toBe(false));
  it("not due: attempts already at the cap", () => expect(dueForRetry({ type: "saas_pause", error: "e", attempts: MAX_EFFECT_ATTEMPTS }, now)).toBe(false));
  it("not due: backoff hasn't elapsed", () => expect(dueForRetry({ type: "saas_pause", error: "e", attempts: 1, nextRetryAt: new Date(now.getTime() + 1000).toISOString() }, now)).toBe(false));
  it("due: backoff elapsed, under the cap", () => expect(dueForRetry({ type: "saas_pause", error: "e", attempts: 1, nextRetryAt: new Date(now.getTime() - 1000).toISOString() }, now)).toBe(true));
});

describe("executeEffects (the first attempt, right after commit)", () => {
  it("success: executedAt set, no error/attempts", async () => {
    const pause = vi.fn(async () => {});
    const out = await executeEffects([{ type: "saas_pause" }], "loc1", { pause });
    expect(pause).toHaveBeenCalledWith("loc1");
    expect(out[0]).toMatchObject({ type: "saas_pause", executedAt: expect.any(String) });
    expect(out[0].error).toBeUndefined();
  });
  it("failure: error set, attempts=1, nextRetryAt scheduled ~5 minutes out", async () => {
    const pause = vi.fn(async () => { throw new Error("GHL down"); });
    const before = Date.now();
    const out = await executeEffects([{ type: "saas_pause" }], "loc1", { pause });
    expect(out[0]).toMatchObject({ type: "saas_pause", error: "GHL down", attempts: 1 });
    expect(new Date(out[0].nextRetryAt as string).getTime() - before).toBeGreaterThan(4 * 60_000);
  });
  it("no locationId: fails without calling pause/unpause", async () => {
    const pause = vi.fn(async () => {});
    const out = await executeEffects([{ type: "saas_pause" }], null, { pause });
    expect(pause).not.toHaveBeenCalled();
    expect(out[0].error).toMatch(/no locationId/);
  });
});

describe("retrySideEffects", () => {
  const now = () => new Date("2026-09-27T00:00:00Z");
  const due = (over: Partial<SideEffectResult> = {}): SideEffectResult => ({ type: "saas_pause", error: "prior failure", attempts: 1, nextRetryAt: new Date("2026-09-26").toISOString(), ...over });

  it("success clears error/attempts and sets executedAt; a not-due effect on the same decision is untouched", async () => {
    const notDue: SideEffectResult = { type: "saas_resume", executedAt: "already-done" };
    const decisions = [decision({ sideEffects: [due(), notDue] })];
    const accounts = [{ id: "a1", locationId: "loc1" }];
    const unpause = vi.fn(async () => {});
    const pause = vi.fn(async () => {});
    const stats = await retrySideEffects(makeDb(decisions, accounts) as any, { now, deps: { pause, unpause } });
    expect(stats).toMatchObject({ attempted: 1, succeeded: 1, stillFailing: 0, exhausted: 0, superseded: 0 });
    expect(pause).toHaveBeenCalledWith("loc1");
    const [d] = decisions;
    expect(d.sideEffects[0]).toMatchObject({ executedAt: expect.any(String) });
    expect(d.sideEffects[0].error).toBeUndefined();
    expect(d.sideEffects[1]).toEqual(notDue); // never touched
  });

  it("a failure short of the cap increments attempts and reschedules further out", async () => {
    const decisions = [decision({ sideEffects: [due({ attempts: 2 })] })];
    const accounts = [{ id: "a1", locationId: "loc1" }];
    const pause = vi.fn(async () => { throw new Error("still down"); });
    const stats = await retrySideEffects(makeDb(decisions, accounts) as any, { now, deps: { pause } });
    expect(stats).toMatchObject({ attempted: 1, succeeded: 0, stillFailing: 1, exhausted: 0 });
    expect(decisions[0].sideEffects[0]).toMatchObject({ attempts: 3, error: "still down" });
    expect(decisions[0].sideEffects[0].exhausted).toBeUndefined();
    expect(new Date(decisions[0].sideEffects[0].nextRetryAt).getTime()).toBeGreaterThan(now().getTime());
  });

  it("a failure that reaches MAX_EFFECT_ATTEMPTS is marked exhausted and never scheduled again", async () => {
    const decisions = [decision({ sideEffects: [due({ attempts: MAX_EFFECT_ATTEMPTS - 1 })] })];
    const accounts = [{ id: "a1", locationId: "loc1" }];
    const pause = vi.fn(async () => { throw new Error("still down"); });
    const stats = await retrySideEffects(makeDb(decisions, accounts) as any, { now, deps: { pause } });
    expect(stats).toMatchObject({ exhausted: 1, stillFailing: 0 });
    expect(decisions[0].sideEffects[0]).toMatchObject({ attempts: MAX_EFFECT_ATTEMPTS, exhausted: true, nextRetryAt: undefined });
  });

  it("idempotent: a later live decision for the same account supersedes an older due effect — never retried, never calls GHL", async () => {
    const older = decision({ id: "d1", eventAt: new Date("2026-09-20"), createdAt: new Date("2026-09-20"), sideEffects: [due()] });
    const newer = decision({ id: "d2", eventAt: new Date("2026-09-25"), createdAt: new Date("2026-09-25"), sideEffects: [] });
    const decisions = [newer, older]; // findMany pool order (createdAt desc) — newer first
    const accounts = [{ id: "a1", locationId: "loc1" }];
    const pause = vi.fn(async () => {});
    const stats = await retrySideEffects(makeDb(decisions, accounts) as any, { now, deps: { pause } });
    expect(pause).not.toHaveBeenCalled();
    expect(stats.superseded).toBe(1);
    expect(older.sideEffects[0]).toMatchObject({ superseded: true });
  });

  it("nothing due: no-op, no db writes beyond the read", async () => {
    const decisions = [decision({ sideEffects: [{ type: "saas_pause", executedAt: "x" }] })];
    const accounts = [{ id: "a1", locationId: "loc1" }];
    const stats = await retrySideEffects(makeDb(decisions, accounts) as any, { now });
    expect(stats).toEqual({ attempted: 0, succeeded: 0, stillFailing: 0, exhausted: 0, superseded: 0 });
  });
});

describe("getFailedSideEffects (Health)", () => {
  it("an exhausted saas_resume is severity 'alert'", async () => {
    const decisions = [decision({ sideEffects: [{ type: "saas_resume", error: "e", exhausted: true, attempts: 5 }] })];
    const rows = await getFailedSideEffects(makeDb(decisions, []) as any);
    expect(rows[0]).toMatchObject({ type: "saas_resume", severity: "alert" });
  });
  it("an exhausted saas_pause is severity 'warning'", async () => {
    const decisions = [decision({ sideEffects: [{ type: "saas_pause", error: "e", exhausted: true, attempts: 5 }] })];
    const rows = await getFailedSideEffects(makeDb(decisions, []) as any);
    expect(rows[0]).toMatchObject({ type: "saas_pause", severity: "warning" });
  });
  it("a still-retrying (not exhausted) failure is severity 'retrying', not alerted", async () => {
    const decisions = [decision({ sideEffects: [{ type: "saas_resume", error: "e", attempts: 2, nextRetryAt: "later" }] })];
    const rows = await getFailedSideEffects(makeDb(decisions, []) as any);
    expect(rows[0].severity).toBe("retrying");
  });
  it("executed or superseded effects never appear", async () => {
    const decisions = [decision({ sideEffects: [{ type: "saas_pause", executedAt: "x" }, { type: "saas_pause", error: "e", superseded: true }] })];
    const rows = await getFailedSideEffects(makeDb(decisions, []) as any);
    expect(rows).toEqual([]);
  });
});
