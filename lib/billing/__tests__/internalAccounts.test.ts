import { describe, expect, it } from "vitest";
import { ingestTransaction } from "../ingestTransaction";
import { listWalletLocations } from "../jobs/locations";
import { AUTO_DESC, listTxn } from "./fixtures";

type Acc = { id: string; contactId: string; locationId: string | null; accountType: "member" | "internal" };
const HQ = "LOC_HQ";
const accounts: Acc[] = [
  { id: "a_m1", contactId: "c_m1", locationId: "LOC_M1", accountType: "member" },
  { id: "a_m2", contactId: "c_m2", locationId: "LOC_M2", accountType: "member" },
  { id: "a_owner", contactId: "c_owner", locationId: HQ, accountType: "internal" }, // owner account: locationId IS the HQ location
];

/** Delegates that honor accountType/locationId filters like the real query would. */
const fake = () => ({
  ghlAccount: {
    findMany: async ({ where }: { where: { locationId?: { not: null }; accountType?: string } }) =>
      accounts.filter((a) => (where.locationId?.not === null ? a.locationId !== null : true) && (where.accountType ? a.accountType === where.accountType : true)),
    findFirst: async ({ where }: { where: { contactId?: string; locationId?: string; accountType?: string } }) =>
      accounts.find((a) => (where.contactId ? a.contactId === where.contactId : true) && (where.locationId ? a.locationId === where.locationId : true) && (where.accountType ? a.accountType === where.accountType : true)) ?? null,
  },
  billingLedgerEntry: { rows: new Map<string, any>(), findUnique: async () => null, upsert: async () => undefined },
});

describe("internal accounts are excluded from member logic", () => {
  it("wallet location list: members + HQ exactly once, HQ without an account id", async () => {
    process.env.GHL_HQ_LOCATION_ID = HQ;
    const locs = await listWalletLocations(fake() as any);
    expect(locs.map((l) => l.locationId)).toEqual(["LOC_HQ", "LOC_M1", "LOC_M2"]);
    expect(locs.filter((l) => l.locationId === HQ)).toHaveLength(1);
    expect(locs.find((l) => l.locationId === HQ)?.ghlAccountId).toBeNull(); // not the internal account's id
    expect(locs.find((l) => l.locationId === "LOC_M1")?.ghlAccountId).toBe("a_m1");
  });

  it("without GHL_HQ_LOCATION_ID the internal account's location is NOT added implicitly", async () => {
    delete process.env.GHL_HQ_LOCATION_ID;
    expect((await listWalletLocations(fake() as any)).map((l) => l.locationId)).toEqual(["LOC_M1", "LOC_M2"]);
  });

  it("a payment from the internal contact does not match any account", async () => {
    const db = fake();
    const r = await ingestTransaction(listTxn({ id: "aaaaaaaaaaaaaaaaaaaaaad1", amount: 57, subscriptionId: "sub1", contactId: "c_owner" }), db as any);
    expect(r).toMatchObject({ action: "written", matchedAccount: false, matchMethod: null });
  });

  it("an auto-recharge whose description points at the HQ location does not match the internal account", async () => {
    const desc = AUTO_DESC.replace("LOCATION0000000000002", HQ);
    const r = await ingestTransaction(listTxn({ id: "aaaaaaaaaaaaaaaaaaaaaad2", amount: 10, subType: "saas_one_time", description: desc, contactId: "unknown" }), fake() as any);
    expect(r).toMatchObject({ classification: "wallet_auto_recharge", matchedAccount: false });
  });

  it("member matching still works", async () => {
    const r = await ingestTransaction(listTxn({ id: "aaaaaaaaaaaaaaaaaaaaaad3", amount: 57, subscriptionId: "sub1", contactId: "c_m1" }), fake() as any);
    expect(r).toMatchObject({ matchedAccount: true, matchMethod: "contactId" });
  });
});
