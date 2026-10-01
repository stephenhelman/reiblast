import { describe, expect, it } from "vitest";
import { processStageChanged } from "../../events/stageChanged";

type Row = Record<string, any>;

/** Minimal fake covering only what processStageChanged's onboarding branch touches. */
function makeFakeDb(opts: { account: Row; priorEvents?: Row[] }) {
  const events: Row[] = opts.priorEvents ?? [];
  let eseq = 1000;
  const account = { ...opts.account };
  const db: any = {
    ghlEvent: {
      findUnique: async ({ where }: any) => events.find((e) => e.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        events.filter(
          (e) =>
            e.source === where.source &&
            e.externalId === where.externalId &&
            e.id !== where.id.not &&
            e.processedAt !== null &&
            e.receivedAt.getTime() >= where.receivedAt.gte.getTime(),
        ),
      update: async ({ where, data }: any) => {
        const e = events.find((x) => x.id === where.id)!;
        Object.assign(e, data);
        return e;
      },
      create: async ({ data }: any) => {
        const row = { id: `e${++eseq}`, receivedAt: new Date(), processedAt: null, attempts: 0, lastError: null, ...data };
        events.push(row);
        return row;
      },
    },
    ghlAccount: {
      findFirst: async () => ({ id: account.id, onboardingStage: account.onboardingStage, onboardingProgress: account.onboardingProgress }),
      update: async ({ data }: any) => {
        Object.assign(account, data);
        return account;
      },
    },
  };
  return { db, events, account };
}

function seedEvent(events: Row[], payload: Row, receivedAt = new Date("2026-09-30T12:00:00Z")) {
  const row = { id: `e${events.length + 1}`, source: "stage_change", externalId: payload.contactId, payload, receivedAt, processedAt: null, attempts: 0, lastError: null };
  events.push(row);
  return row;
}

const CONTACT = "abcd1234efgh5678";

describe("processStageChanged — onboarding pipeline", () => {
  it("updates onboardingStage always, and bumps onboardingProgress on forward progress", async () => {
    const { db, events, account } = makeFakeDb({ account: { id: "A1", onboardingStage: null, onboardingProgress: null } });
    const e = seedEvent(events, { contactId: CONTACT, pipeline: "onboarding", stage: "New Client" });
    const result = await processStageChanged(e.id, { db });
    expect(result).toBe("processed");
    expect(account.onboardingStage).toBe("New Client");
    expect(account.onboardingProgress).toBe("New Client");
    expect(account.onboardingProgressAt).toBeInstanceOf(Date);
  });

  it("a side stage updates onboardingStage but never touches onboardingProgress", async () => {
    const { db, events, account } = makeFakeDb({ account: { id: "A1", onboardingStage: "New Client", onboardingProgress: "New Client" } });
    const e = seedEvent(events, { contactId: CONTACT, pipeline: "onboarding", stage: "Payment Failed" });
    await processStageChanged(e.id, { db });
    expect(account.onboardingStage).toBe("Payment Failed");
    expect(account.onboardingProgress).toBe("New Client"); // unchanged
  });

  it("a backward stage move updates onboardingStage but does not regress onboardingProgress", async () => {
    const { db, events, account } = makeFakeDb({ account: { id: "A1", onboardingStage: "A2P Pending", onboardingProgress: "A2P Pending" } });
    const e = seedEvent(events, { contactId: CONTACT, pipeline: "onboarding", stage: "Onboarding Form Confirmed" });
    await processStageChanged(e.id, { db });
    expect(account.onboardingStage).toBe("Onboarding Form Confirmed");
    expect(account.onboardingProgress).toBe("A2P Pending"); // unchanged — not forward
  });

  it("an unrecognized stage name still updates the onboardingStage display field but is never guess-mapped into progress; it is recorded for investigation", async () => {
    const { db, events, account } = makeFakeDb({ account: { id: "A1", onboardingStage: "New Client", onboardingProgress: "New Client" } });
    const e = seedEvent(events, { contactId: CONTACT, pipeline: "onboarding", stage: "Some Renamed Stage" });
    await processStageChanged(e.id, { db });
    expect(account.onboardingStage).toBe("Some Renamed Stage");
    expect(account.onboardingProgress).toBe("New Client"); // unchanged — never guessed
    expect(events.some((ev) => ev.source === "stage_change_unmapped" && ev.externalId === CONTACT)).toBe(true);
  });
});
