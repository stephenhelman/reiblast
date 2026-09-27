import { describe, expect, it } from "vitest";
import { getIntentsHealth, getRecentGhlEvents, getUnpaidSubscriptions } from "@/lib/billing/reports/health";

const acct = (id: string, contactId: string, loc: string, name: string | null, biz: string | null) => ({ id, contactId, locationId: loc, locationName: name, user: { businessName: biz } });

/** Minimal stand-in for the delegates the new Health queries use. */
const fakeDb = (o: { intents?: any[]; events?: any[]; subs?: any[]; accounts?: any[] }): any => ({
  ghlIntent: {
    groupBy: async () => Object.entries((o.intents ?? []).reduce((m: Record<string, number>, i) => ((m[i.status] = (m[i.status] ?? 0) + 1), m), {})).map(([status, n]) => ({ status, _count: { _all: n } })),
    findMany: async ({ take }: any) => [...(o.intents ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, take),
  },
  ghlEvent: { findMany: async ({ where, take }: any) => (o.events ?? []).filter((e) => where.source.in.includes(e.source)).sort((a, b) => b.receivedAt - a.receivedAt).slice(0, take) },
  ghlSubscriptionState: { findMany: async ({ where }: any) => (o.subs ?? []).filter((s) => s.status === where.status) },
  ghlAccount: {
    findMany: async ({ where }: any) => (o.accounts ?? []).filter((a) => (!where.id || where.id.in.includes(a.id)) && (!where.contactId || where.contactId.in.includes(a.contactId))),
  },
});

describe("Health: intents outbox", () => {
  const intents = [
    { id: "i1", createdAt: new Date("2026-09-28T10:00:00Z"), ghlAccountId: "A1", kind: "stage", pipeline: "active_client", status: "skipped_shadow", attempts: 0, lastError: null, sentAt: null, payload: { stage: "paused" } },
    { id: "i2", createdAt: new Date("2026-09-28T11:00:00Z"), ghlAccountId: "A2", kind: "fields", pipeline: "active_client", status: "failed", attempts: 2, lastError: "HTTP 500", sentAt: null, payload: { stage: "trial" } },
    { id: "i3", createdAt: new Date("2026-09-28T12:00:00Z"), ghlAccountId: "A1", kind: "stage", pipeline: "active_client", status: "pending", attempts: 0, lastError: null, sentAt: null, payload: { stage: "active" } },
  ];
  it("counts every status (zero-filled), lists newest first with account labels", async () => {
    const h = await getIntentsHealth(fakeDb({ intents, accounts: [acct("A1", "c1", "LOC_AAAA", "Acme", null), acct("A2", "c2", "LOC_BBBB", null, "Beta LLC")] }));
    expect(h.counts).toEqual({ pending: 1, sent: 0, failed: 1, skipped_shadow: 1 });
    expect(h.last.map((l) => l.id)).toEqual(["i3", "i2", "i1"]);
    expect(h.last[0]).toMatchObject({ stage: "active", label: { locationName: "Acme" } });
    expect(h.last[1]).toMatchObject({ kind: "fields", label: { businessName: "Beta LLC" }, lastError: "HTTP 500" });
  });
  it("an empty outbox is all zeros", async () => {
    expect((await getIntentsHealth(fakeDb({}))).counts).toEqual({ pending: 0, sent: 0, failed: 0, skipped_shadow: 0 });
  });
});

describe("Health: recent stage-change and invoice events", () => {
  it("only stage_change and invoice sources, newest first, summarized, with labels for stage events", async () => {
    const events = [
      { id: "e1", source: "payment", externalId: "tx", payload: {}, receivedAt: new Date("2026-09-28T09:00:00Z"), processedAt: new Date(), attempts: 0, lastError: null },
      { id: "e2", source: "stage_change", externalId: "c1", payload: { pipeline: "active_client", stage: "paused" }, receivedAt: new Date("2026-09-28T10:00:00Z"), processedAt: new Date(), attempts: 0, lastError: null },
      { id: "e3", source: "invoice", externalId: "INVOICE00009999", payload: { invoiceId: "INVOICE00009999" }, receivedAt: new Date("2026-09-28T11:00:00Z"), processedAt: null, attempts: 2, lastError: "HTTP 500" },
    ];
    const r = await getRecentGhlEvents(fakeDb({ events, accounts: [acct("A1", "c1", "LOC_AAAA", "Acme", null)] }));
    expect(r.map((e) => e.id)).toEqual(["e3", "e2"]);
    expect(r[0]).toMatchObject({ summary: "invoice …9999", label: null, attempts: 2, lastError: "HTTP 500" });
    expect(r[1]).toMatchObject({ summary: "active_client → paused", label: { locationName: "Acme" } });
  });
});

describe("Health: unpaid subscriptions (informational)", () => {
  it("lists only status unpaid with account labels; a contact with no member account is still listed", async () => {
    const subs = [
      { subscriptionId: "S1", contactId: "c1", status: "unpaid", name: "REIblast Core", lastSeenAt: new Date("2026-09-28T00:00:00Z") },
      { subscriptionId: "S2", contactId: "c2", status: "active", name: "REIblast Core", lastSeenAt: new Date() },
      { subscriptionId: "S3", contactId: "ghost", status: "unpaid", name: null, lastSeenAt: new Date("2026-09-27T00:00:00Z") },
    ];
    const r = await getUnpaidSubscriptions(fakeDb({ subs, accounts: [acct("A1", "c1", "LOC_AAAA", "Acme", null)] }));
    expect(r.map((x) => x.subscriptionId)).toEqual(["S1", "S3"]);
    expect(r[0].label).toMatchObject({ locationName: "Acme" });
    expect(r[1].label).toBeNull();
  });
});
