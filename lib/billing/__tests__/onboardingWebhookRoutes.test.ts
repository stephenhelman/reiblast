import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the mocking style of lib/billing/__tests__/state/routes.test.ts / jobsRoute.test.ts, adapted for routes
// that use `@/lib/prisma` directly (no injectable db layer) rather than lib/billing/db.ts's getBillingDb().

vi.mock("@/lib/ghl/verifyWebhook", () => ({ verifyWebhook: () => true }));
const fakePrisma = vi.hoisted(() => ({ current: null as any }));
// Real dual-write behavior is out of scope here; this stand-in mirrors just enough of
// lib/billing/state/dualWrite.ts's contract (upsert-by-userId) against the same fake db these tests use.
vi.mock("@/lib/billing/state/dualWrite", () => ({
  ensureGhlAccount: vi.fn(async (_db: any, p: { userId: string; contactId: string | null | undefined }) => {
    if (!p.contactId) return;
    const db = fakePrisma.current;
    const existing = db.ghlAccounts.find((a: any) => a.userId === p.userId);
    if (!existing) db.ghlAccounts.push({ id: `a${db.ghlAccounts.length + 1}`, userId: p.userId, contactId: p.contactId, accountType: "member" });
    else existing.contactId = p.contactId;
  }),
  setGhlAccountLocation: vi.fn(async () => {}),
}));

const ghlCalls = vi.hoisted(() => ({ tags: [] as string[], moveToStageCalls: [] as unknown[] }));
vi.mock("@/lib/ghl", () => ({
  createHQContact: vi.fn(async () => ({ contactId: "CONTACT_NEW" })),
  addTag: vi.fn(async (contactId: string, tag: string) => {
    ghlCalls.tags.push(tag);
    return true;
  }),
  moveToStage: vi.fn(async (...args: unknown[]) => {
    ghlCalls.moveToStageCalls.push(args);
    return true;
  }),
  findSubAccountByName: vi.fn(async () => "LOC1"),
  findSubAccountByEmail: vi.fn(async () => null),
  populateSubAccountCustomValues: vi.fn(async () => true),
  updateSubAccountProfile: vi.fn(async () => true),
}));

type Row = Record<string, any>;

function makeFakePrisma() {
  const users: Row[] = [];
  const ghlAccounts: Row[] = [];
  const intents: Row[] = [];
  let uid = 0;
  let aid = 0;
  let iid = 0;

  const db: any = {
    users,
    ghlAccounts,
    intents,
    user: {
      findUnique: async ({ where }: any) => users.find((u) => u.email === where.email || u.id === where.id) ?? null,
      findFirst: async ({ where }: any) => users.find((u) => u.email === where.email) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `u${++uid}`, status: null, ...data };
        users.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = users.find((u) => u.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    ghlAccount: {
      findUnique: async ({ where }: any) => ghlAccounts.find((a) => a.userId === where.userId) ?? null,
      findFirst: async ({ where }: any) => ghlAccounts.find((a) => a.userId === where.userId) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `a${++aid}`, ...data };
        ghlAccounts.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = ghlAccounts.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    ghlIntent: {
      create: async ({ data }: any) => {
        const { Prisma } = await import("@prisma/client");
        if (intents.some((i) => i.dedupeKey === data.dedupeKey)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        const row = { id: `i${++iid}`, attempts: 0, ...data };
        intents.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => intents.find((i) => i.dedupeKey === where.dedupeKey) ?? null,
    },
  };
  return db;
}

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fakePrisma.current;
  },
}));

beforeEach(() => {
  fakePrisma.current = makeFakePrisma();
  ghlCalls.tags = [];
  ghlCalls.moveToStageCalls = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const postJson = (body: unknown) =>
  new NextRequest("https://example.test/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/webhooks/ghl — status-reset fix + new_client dedupe", () => {
  it("an existing member hitting this route again never has status reset back to pending_onboarding", async () => {
    const { POST } = await import("@/app/api/webhooks/ghl/route");
    const db = fakePrisma.current;
    db.users.push({ id: "u1", email: "member@example.test", status: "active", plan: "core" });

    const res = await POST(postJson({ email: "member@example.test", full_name: "Member One" }));
    expect(res.status).toBe(200);
    const updated = db.users.find((u: any) => u.id === "u1");
    expect(updated.status).toBe("active"); // untouched
    expect(updated.plan).toBe("core");
  });

  it("a brand-new member still gets status pending_onboarding on creation", async () => {
    const { POST } = await import("@/app/api/webhooks/ghl/route");
    const db = fakePrisma.current;

    await POST(postJson({ email: "new@example.test", full_name: "New Person" }));
    const created = db.users.find((u: any) => u.email === "new@example.test");
    expect(created.status).toBe("pending_onboarding");
  });

  it("new_client intent is enqueued once for a new member, deduped on repeat delivery for the same account", async () => {
    const { POST } = await import("@/app/api/webhooks/ghl/route");
    const db = fakePrisma.current;

    const body = { email: "dup@example.test", full_name: "Dup Person" };
    await POST(postJson(body));
    // Simulate a duplicate webhook delivery hitting the route again for the same (now-existing) member.
    await POST(postJson(body));

    const newClientIntents = db.intents.filter((i: any) => i.payload?.stage === "new_client");
    expect(newClientIntents).toHaveLength(1);
  });

  it("an existing member hit does NOT enqueue a new_client intent", async () => {
    const { POST } = await import("@/app/api/webhooks/ghl/route");
    const db = fakePrisma.current;
    db.users.push({ id: "u1", email: "existing@example.test", status: "active", plan: "core" });

    await POST(postJson({ email: "existing@example.test", full_name: "Existing Person" }));
    expect(db.intents.filter((i: any) => i.payload?.stage === "new_client")).toHaveLength(0);
  });
});

describe("POST /api/webhooks/ghl-provision — onboardingProgress no-op gate", () => {
  it("no-ops (200, noop:true) when onboardingProgress is already at/past Onboarding Form Confirmed, and does not re-provision", async () => {
    const { POST } = await import("@/app/api/webhooks/ghl-provision/route");
    const { populateSubAccountCustomValues } = await import("@/lib/ghl");
    const db = fakePrisma.current;
    db.users.push({ id: "u1", email: "far@example.test", ghlLocationId: "LOCX", businessName: "Acme" });
    db.ghlAccounts.push({ id: "a1", userId: "u1", contactId: "CONTACTX", onboardingProgress: "Sub Account Provisioned" });

    const res = await POST(postJson({ email: "far@example.test", contact_id: "CONTACTX", full_name: "Far Person" }));
    const json = await res.json();
    expect(json.noop).toBe(true);
    expect(populateSubAccountCustomValues).not.toHaveBeenCalled();
  });

  it("proceeds normally (no no-op) when onboardingProgress is earlier than Onboarding Form Confirmed", async () => {
    const { POST } = await import("@/app/api/webhooks/ghl-provision/route");
    const { populateSubAccountCustomValues } = await import("@/lib/ghl");
    const db = fakePrisma.current;
    db.users.push({ id: "u1", email: "early@example.test", ghlLocationId: "LOCY", businessName: "Acme" });
    db.ghlAccounts.push({ id: "a1", userId: "u1", contactId: "CONTACTY", onboardingProgress: "New Client" });

    const res = await POST(postJson({ email: "early@example.test", contact_id: "CONTACTY", full_name: "Early Person" }));
    const json = await res.json();
    expect(json.noop).toBeUndefined();
    expect(json.success).toBe(true);
    expect(populateSubAccountCustomValues).toHaveBeenCalled();
  });

  it("proceeds normally when there is no GhlAccount row yet (never provisioned)", async () => {
    const { POST } = await import("@/app/api/webhooks/ghl-provision/route");
    const db = fakePrisma.current;
    db.users.push({ id: "u1", email: "brand-new@example.test", ghlLocationId: "LOCZ", businessName: "Acme" });

    const res = await POST(postJson({ email: "brand-new@example.test", contact_id: "CONTACTZ", full_name: "Brand New" }));
    const json = await res.json();
    expect(json.noop).toBeUndefined();
    expect(json.success).toBe(true);
  });
});
