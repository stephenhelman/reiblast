import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/** Cursor pagination + row-level (evidence) queries shared by the drill-down pages, member views and CSV exports. */

/** Anything with the raw-SQL entry point (a PrismaClient or an interactive-transaction client). */
export type SqlDb = Pick<PrismaClient, "$queryRaw">;

export type Cursor = { t: string; id: string }; // (ISO timestamp, id) — keyset position of the last row returned
export const encodeCursor = (c: Cursor): string => Buffer.from(`${c.t}|${c.id}`).toString("base64url");
export function decodeCursor(s: string | null | undefined): Cursor | null {
  if (!s) return null;
  try {
    const [t, ...rest] = Buffer.from(s, "base64url").toString().split("|");
    const id = rest.join("|");
    return t && id && !Number.isNaN(Date.parse(t)) ? { t, id } : null;
  } catch {
    return null;
  }
}

export const PAGE_SIZE = 100;
export type Page<T> = { rows: T[]; nextCursor: string | null };

/** Keyset pagination over an in-memory list already sorted by (time desc, id desc). */
export function pageOf<T>(sorted: T[], keyOf: (r: T) => Cursor, cursor: Cursor | null, limit = PAGE_SIZE): Page<T> {
  let start = 0;
  if (cursor) {
    const at = Date.parse(cursor.t);
    start = sorted.findIndex((r) => {
      const k = keyOf(r);
      const kt = Date.parse(k.t);
      return kt < at || (kt === at && k.id < cursor.id);
    });
    if (start === -1) return { rows: [], nextCursor: null };
  }
  const rows = sorted.slice(start, start + limit);
  const more = start + limit < sorted.length;
  return { rows, nextCursor: more ? encodeCursor(keyOf(rows[rows.length - 1])) : null };
}

export const byTimeDescIdDesc = <T>(keyOf: (r: T) => Cursor) => (a: T, b: T): number => {
  const d = Date.parse(keyOf(b).t) - Date.parse(keyOf(a).t);
  return d !== 0 ? d : keyOf(a).id < keyOf(b).id ? 1 : keyOf(a).id > keyOf(b).id ? -1 : 0;
};

// The ISO string ('…Z') cast to `timestamp` keeps the UTC wall clock whatever the session timezone is.
// ── wallet transactions (SQL, raw only so tests can shadow the table with a TEMP table) ─────────────

export type WalletRow = { id: string; scopeKey: string; ghlAccountId: string | null; settlementTime: Date; category: string; description: string; amount: string };

/** Keyset page of WalletTransaction rows (newest first) matching `where` (a SQL boolean expression built by the caller). */
export async function walletPage(db: SqlDb, where: Prisma.Sql, cursor: Cursor | null, limit = PAGE_SIZE): Promise<Page<WalletRow>> {
  const after = cursor ? Prisma.sql`AND ("settlementTime" < ${cursor.t}::timestamp OR ("settlementTime" = ${cursor.t}::timestamp AND "id" < ${cursor.id}))` : Prisma.empty;
  const rows = await db.$queryRaw<WalletRow[]>`
    SELECT "id", "scopeKey", "ghlAccountId", "settlementTime", "category", "description", "amount"::text AS "amount"
    FROM "WalletTransaction"
    WHERE ${where} ${after}
    ORDER BY "settlementTime" DESC, "id" DESC
    LIMIT ${limit + 1}`;
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return { rows: page, nextCursor: more ? encodeCursor({ t: page[page.length - 1].settlementTime.toISOString(), id: page[page.length - 1].id }) : null };
}

/** Every row matching `where`, in bounded chunks (for CSV export). */
export async function* walletChunks(db: SqlDb, where: Prisma.Sql, chunk = 5000): AsyncGenerator<WalletRow[]> {
  let cursor: Cursor | null = null;
  for (;;) {
    const page: Page<WalletRow> = await walletPage(db, where, cursor, chunk);
    if (page.rows.length) yield page.rows;
    if (!page.nextCursor) return;
    cursor = decodeCursor(page.nextCursor);
  }
}
