import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as any, boom: false, claimResult: true }));
vi.mock("@/lib/billing/db", () => ({ getBillingDb: async () => { if (holder.boom) throw new Error("db down"); return holder.db; } }));
vi.mock("@vercel/functions", () => ({ waitUntil: (_p: Promise<unknown>) => { _p.catch(() => {}); } }));
const runJobMock = vi.hoisted(() => vi.fn(async () => ({ status: "done", summary: {} })));
vi.mock("@/lib/billing/jobs/runner", async (orig) => {
  const mod = await orig<typeof import("@/lib/billing/jobs/runner")>();
  return { ...mod, runJob: runJobMock, claim: async () => holder.claimResult };
});

import { POST as jobsRoute } from "@/app/api/webhooks/ghl/jobs/route";

const SECRET = "test-jobs-secret";

function makeDb() {
  const events: any[] = [];
  return {
    events,
    ghlEvent: { create: async ({ data }: any) => { const row = { id: `ev${events.length + 1}`, ...data }; events.push(row); return row; } },
    jobRun: { upsert: async ({ where }: any) => ({ id: "jr1", job: where.job }) },
  };
}

const req = (body: unknown, headers: Record<string, string> = { "x-reiblast-jobs-secret": SECRET }, raw?: string) =>
  new NextRequest("https://example.test/api/webhooks/ghl/jobs", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) });

beforeEach(() => {
  process.env.GHL_JOBS_SECRET = SECRET;
  holder.db = makeDb();
  holder.boom = false;
  holder.claimResult = true;
  runJobMock.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("jobs route: reason codes, always 200, every attempt recorded", () => {
  it("GHL_JOBS_SECRET unset → server_misconfigured, no attempt to reach the db for a trigger row", async () => {
    delete process.env.GHL_JOBS_SECRET;
    const res = await jobsRoute(req({ job: "replay" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: false, reason: "server_misconfigured" });
  });
  it("missing header → auth_missing, recorded", async () => {
    const res = await jobsRoute(req({ job: "replay" }, {}));
    expect(await res.json()).toEqual({ accepted: false, reason: "auth_missing" });
    expect(holder.db.events).toMatchObject([{ source: "job_trigger", payload: { reason: "auth_missing" } }]);
  });
  it("wrong secret → auth_failed, recorded", async () => {
    const res = await jobsRoute(req({ job: "replay" }, { "x-reiblast-jobs-secret": "nope" }));
    expect(await res.json()).toEqual({ accepted: false, reason: "auth_failed" });
    expect(holder.db.events[0]).toMatchObject({ source: "job_trigger", payload: { reason: "auth_failed" } });
  });
  it("invalid JSON → bad_json, recorded", async () => {
    const res = await jobsRoute(req(null, undefined, "{not json"));
    expect(await res.json()).toEqual({ accepted: false, reason: "bad_json" });
    expect(holder.db.events[0]).toMatchObject({ source: "job_trigger", payload: { reason: "bad_json" } });
  });
  it("unknown job → unknown_job, recorded with no job name and the body's keys", async () => {
    const res = await jobsRoute(req({ job: "not_a_real_job" }));
    expect(await res.json()).toEqual({ accepted: false, reason: "unknown_job" });
    expect(holder.db.events[0]).toMatchObject({ source: "job_trigger", externalId: null, payload: { reason: "unknown_job", bodyKeys: ["job"] } });
  });
  it("a cursor already past the continuation cap → continuation_cap, recorded, job never runs", async () => {
    const res = await jobsRoute(req({ job: "replay", cursor: { _continuation: 11 } }));
    expect(await res.json()).toEqual({ accepted: false, job: "replay", reason: "continuation_cap" });
    expect(runJobMock).not.toHaveBeenCalled();
  });
  it("claim fails (a run is already in flight) → in_flight, recorded, job never runs", async () => {
    holder.claimResult = false;
    const res = await jobsRoute(req({ job: "replay" }));
    expect(await res.json()).toEqual({ accepted: false, job: "replay", reason: "in_flight" });
    expect(runJobMock).not.toHaveBeenCalled();
  });
  it("a fresh, authenticated, known job → accepted, recorded with the job and its JobRun id, and the job is started", async () => {
    const res = await jobsRoute(req({ job: "replay" }));
    expect(await res.json()).toEqual({ accepted: true, job: "replay", reason: "accepted" });
    expect(holder.db.events[0]).toMatchObject({ source: "job_trigger", externalId: "replay", payload: { reason: "accepted", jobRunId: "jr1" } });
    expect(runJobMock).toHaveBeenCalledWith("replay", expect.objectContaining({ preClaimed: true }));
  });
  it("a continuation (cursor present) is accepted without re-claiming", async () => {
    const res = await jobsRoute(req({ job: "replay", cursor: { _continuation: 1, phase: "list" } }));
    expect(await res.json()).toEqual({ accepted: true, job: "replay", reason: "accepted" });
    expect(runJobMock).toHaveBeenCalledWith("replay", expect.objectContaining({ preClaimed: false, cursor: { _continuation: 1, phase: "list" } }));
  });
  it("no secret VALUE ever appears in a recorded trigger row", async () => {
    await jobsRoute(req({ job: "replay" }, { "x-reiblast-jobs-secret": "nope-secret-value" }));
    const dump = JSON.stringify(holder.db.events);
    expect(dump).not.toContain("nope-secret-value");
    expect(dump).not.toContain(SECRET);
  });
  it("an unexpected error → internal_error (distinct from a missing env var), still 200, never a stack trace in the body", async () => {
    holder.boom = true;
    const res = await jobsRoute(req({ job: "replay" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reason).toBe("internal_error");
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/); // no stack trace shape
  });
  it("a GhlEvent insert failure (the job_trigger audit row) still returns the reason it already decided on — a logging failure never masks it, and the job still runs", async () => {
    holder.db.ghlEvent.create = async () => { throw new Error("insert exploded"); };
    const res = await jobsRoute(req({ job: "replay" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, job: "replay", reason: "accepted" });
    expect(runJobMock).toHaveBeenCalled(); // the trigger itself was legitimately accepted; only the audit log write failed
  });
  it("server_misconfigured logs which env var is missing, never a value; an unrelated exception never claims to be a config problem", async () => {
    const errSpy = vi.spyOn(console, "error");
    delete process.env.GHL_JOBS_SECRET;
    await jobsRoute(req({ job: "replay" }));
    expect(errSpy.mock.calls.some((c) => c.join(" ").includes("GHL_JOBS_SECRET"))).toBe(true);
    expect(errSpy.mock.calls.some((c) => c.join(" ").includes(SECRET))).toBe(false);

    errSpy.mockClear();
    process.env.GHL_JOBS_SECRET = SECRET;
    holder.boom = true;
    await jobsRoute(req({ job: "replay" }));
    expect(errSpy.mock.calls.some((c) => c.join(" ").includes("internal error"))).toBe(true);
  });
});
