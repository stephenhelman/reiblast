import type { PromoPostDb, PromoPostRow } from "../post";

/** In-memory PromoPost table with the unique (promo, runKey) constraint. */
export function fakePromoDb(rows: Partial<PromoPostRow>[] = []) {
  const table: PromoPostRow[] = rows.map((r, i) => ({
    id: `p${i}`, promo: "founders-2026", runKey: `k${i}`, variation: 1, status: "sent",
    discordMessageId: null, error: null, createdAt: new Date(2026, 9, 1, i), ...r,
  }));
  let seq = 0;
  const db: PromoPostDb = {
    promoPost: {
      findUnique: async ({ where: { promo_runKey: k } }) => table.find((r) => r.promo === k.promo && r.runKey === k.runKey) ?? null,
      findFirst: async ({ where }) =>
        [...table]
          .filter((r) => r.promo === where.promo && r.status === where.status && (!where.runKey || r.runKey !== where.runKey.not))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      create: async ({ data }) => {
        if (table.some((r) => r.promo === data.promo && r.runKey === data.runKey)) throw Object.assign(new Error("dup"), { code: "P2002" });
        const row: PromoPostRow = { id: `n${seq++}`, discordMessageId: null, createdAt: new Date(), ...data };
        table.push(row);
        return row;
      },
      update: async ({ where, data }) => Object.assign(table.find((r) => r.id === where.id)!, data),
    },
  };
  return { db, table };
}
