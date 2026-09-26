import { Prisma } from "@prisma/client";
import { walletBalance } from "../ghlWallet";
import { listWalletLocations, type WalletLocation } from "./locations";
import type { JobFn } from "./types";

type Cursor = { takenOn: string; locations: WalletLocation[]; idx: number; counts: Record<string, number> };

/** Daily wallet-balance snapshot per location (every GhlAccount.locationId + HQ). One row per (locationId, UTC day). */
export const runBalances: JobFn = async (ctx) => {
  const c = ctx.cursor as Cursor | null;
  const st: Cursor = c ?? { takenOn: ctx.now.toISOString().slice(0, 10), locations: await listWalletLocations(ctx.db), idx: 0, counts: {} };
  const takenOn = new Date(`${st.takenOn}T00:00:00.000Z`);

  while (st.idx < st.locations.length) {
    if (ctx.shouldYield()) return { done: false, cursor: st, summary: { ...st.counts, idx: st.idx, of: st.locations.length } };
    const loc = st.locations[st.idx];
    const r = await walletBalance(loc.locationId);
    st.counts[r.status] = (st.counts[r.status] ?? 0) + 1;
    if (ctx.apply) {
      const data = {
        ghlAccountId: loc.ghlAccountId,
        status: r.status,
        balance: r.balance === null ? null : new Prisma.Decimal(String(r.balance)),
        raw: r.raw as Prisma.InputJsonValue,
      };
      await ctx.db.walletBalanceSnapshot.upsert({
        where: { locationId_takenOn: { locationId: loc.locationId, takenOn } },
        create: { locationId: loc.locationId, takenOn, ...data },
        update: data,
      });
    }
    st.idx++;
  }
  return { done: true, summary: { ...st.counts, locations: st.locations.length, takenOn: st.takenOn, dryRun: !ctx.apply } };
};
