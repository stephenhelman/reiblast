import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { enqueueOnboardingIntent, onboardingIntentsMode } from "../onboardingIntents";

type Row = Record<string, any>;

function makeFakeIntentDb() {
  const intents: Row[] = [];
  let seq = 0;
  const db: any = {
    intents,
    ghlIntent: {
      create: async ({ data }: any) => {
        if (intents.some((i) => i.dedupeKey === data.dedupeKey)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        const row = { id: `i${++seq}`, attempts: 0, ...data };
        intents.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => intents.find((i) => i.dedupeKey === where.dedupeKey) ?? null,
    },
  };
  return db;
}

describe("onboardingIntentsMode", () => {
  it("only 'live' is live; unset/anything else is off", () => {
    expect(onboardingIntentsMode({ ONBOARDING_INTENTS: "live" })).toBe("live");
    expect(onboardingIntentsMode({})).toBe("off");
    expect(onboardingIntentsMode({ ONBOARDING_INTENTS: "shadow" })).toBe("off");
    expect(onboardingIntentsMode({ ONBOARDING_INTENTS: "LIVE" })).toBe("off");
  });
});

describe("enqueueOnboardingIntent", () => {
  const account = { id: "A1", contactId: "CONTACT_A1" };

  it("default (off): recorded as skipped_shadow, independent of DUNNING_MODE", async () => {
    const db = makeFakeIntentDb();
    const r = await enqueueOnboardingIntent(db, { account, stageKey: "new_client", env: { DUNNING_MODE: "live" } });
    expect(r.created).toBe(true);
    expect(db.intents[0]).toMatchObject({ status: "skipped_shadow", pipeline: "onboarding", kind: "stage" });
  });

  it("ONBOARDING_INTENTS=live: recorded as pending (sendable)", async () => {
    const db = makeFakeIntentDb();
    const r = await enqueueOnboardingIntent(db, { account, stageKey: "sub_account_provisioned", env: { ONBOARDING_INTENTS: "live" } });
    expect(r.created).toBe(true);
    expect(db.intents[0].status).toBe("pending");
  });

  it("dedupes once per member per stage key, even across repeated calls", async () => {
    const db = makeFakeIntentDb();
    const a = await enqueueOnboardingIntent(db, { account, stageKey: "onboarding_form_submitted" });
    const b = await enqueueOnboardingIntent(db, { account, stageKey: "onboarding_form_submitted" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.id).toBe(b.id);
    expect(db.intents).toHaveLength(1);
  });

  it("different stage keys for the same member are not deduped against each other", async () => {
    const db = makeFakeIntentDb();
    await enqueueOnboardingIntent(db, { account, stageKey: "new_client" });
    await enqueueOnboardingIntent(db, { account, stageKey: "onboarding_form_submitted" });
    expect(db.intents).toHaveLength(2);
  });
});
