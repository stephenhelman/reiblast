/** Minimal in-memory stand-ins for the Prisma delegates the admin auth code touches (no database). */
type Row = Record<string, any>;

function matchField(v: any, cond: any): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    if ("in" in cond) return (cond.in as any[]).includes(v);
    if ("not" in cond) return v !== cond.not;
    if ("gt" in cond && !(v > cond.gt)) return false;
    if ("gte" in cond && !(v >= cond.gte)) return false;
    if ("lt" in cond && !(v < cond.lt)) return false;
    return true;
  }
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  return v === cond;
}
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, c]) => matchField(row[k] ?? null, c === undefined ? null : c));

function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "increment" in v) row[k] = (row[k] ?? 0) + (v as any).increment;
    else row[k] = v;
  }
}

function table(rows: Row[], clock: () => Date, defaults: () => Row = () => ({})) {
  return {
    rows,
    create: async ({ data }: { data: Row }) => {
      const row = { ...defaults(), createdAt: clock(), ...data };
      rows.push(row);
      return row;
    },
    count: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)).length,
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: { createdAt: "asc" | "desc" } } = {}) => {
      const found = rows.filter((r) => matches(r, where));
      if (orderBy) found.sort((a, b) => (orderBy.createdAt === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
      return found[0] ?? null;
    },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
      const found = rows.filter((r) => matches(r, where));
      found.forEach((r) => apply(r, data));
      return { count: found.length };
    },
    deleteMany: async ({ where }: { where?: Row } = {}) => {
      const keep = rows.filter((r) => !matches(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
  };
}

export type FakeAccount = { id: string; contactId: string; locationId: string | null; accountType: "member" | "internal"; user: { id: string; status: string } | null };

export function makeFakeDb(opts: { accounts?: FakeAccount[]; clock?: () => Date } = {}) {
  const clock = opts.clock ?? (() => new Date());
  const accounts = opts.accounts ?? [];
  const challenges = table([], clock, () => ({ attempts: 0, consumedAt: null }));
  const backup = table([], clock, () => ({ usedAt: null }));
  const audit = table([], clock);
  const db: any = {
    ghlAccount: {
      rows: accounts,
      findUnique: async ({ where }: { where: { id?: string; locationId?: string } }) => accounts.find((a) => (where.id ? a.id === where.id : a.locationId === where.locationId)) ?? null,
      findMany: async ({ where }: { where?: Row } = {}) => accounts.filter((a) => matches(a, where)),
    },
    adminAuthChallenge: challenges,
    adminBackupCode: backup,
    adminAuditLog: audit,
  };
  return { db, challenges, backup, audit, accounts };
}

export const OWNER: FakeAccount = { id: "acct_owner", contactId: "contact_owner_0001", locationId: "LOC_HQ", accountType: "internal", user: { id: "user_owner", status: "active" } };
export const TEST_ENV = { ADMIN_SESSION_SECRET: "a".repeat(40), TOOLS_SESSION_SECRET: "b".repeat(40), ADMIN_LOCATION_IDS: "LOC_HQ", ADMIN_TOTP_SECRET: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" };
