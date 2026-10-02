import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Member removal: find the User + GhlAccount for a GHL contact, count EVERY dependent row across all tables, and (only on request)
 * delete them all, then the GhlAccount, then the User, in ONE transaction. Dry-run counts only. CLI: scripts/admin/remove-members.ts.
 *
 * Dependents are an explicit registry (SPECS, children first = delete order) because several tables reference a member with no
 * formal FK (Transaction.userId, GhlEvent, GhlSubscriptionState.contactId, the locationId-keyed tables, …). `unexpectedReferences`
 * cross-checks the registry against the Prisma schema, so a relation added later makes the tool refuse to run rather than miss it;
 * the database's own FKs are the second net (a stray reference makes the transaction fail and roll back).
 */

export type Ctx = {
  contactId: string;
  userId: string;
  accountId: string | null;
  /** The member's GHL location ids (GhlAccount.locationId and User.ghlLocationId), for the tables keyed by location. */
  locationIds: string[];
  toolUseIds: string[];
  cartIds: string[];
  /** GHL transaction ids of the member's ledger rows (GhlEvent.externalId for payment events). */
  ledgerTxnIds: string[];
};

type Where = Record<string, unknown>;
const or = (...w: (Where | null)[]): Where | null => {
  const parts = w.filter((x): x is Where => !!x);
  return parts.length ? { OR: parts } : null;
};
const inList = (field: string, ids: string[]): Where | null => (ids.length ? { [field]: { in: ids } } : null);

export type Spec = { table: string; delegate: string; /** how the rows are found */ by: string; where: (c: Ctx) => Where | null };

/** Delete order: children before parents. GhlEvent is handled separately (found by raw query). The GhlAccount and User rows themselves come last. */
export const SPECS: Spec[] = [
  { table: "CreditHold", delegate: "creditHold", by: "userId", where: (c) => ({ userId: c.userId }) },
  { table: "ApiCall", delegate: "apiCall", by: "toolUseId / locationId", where: (c) => or(inList("toolUseId", c.toolUseIds), inList("locationId", c.locationIds)) },
  { table: "LedgerEntry", delegate: "ledgerEntry", by: "userId", where: (c) => ({ userId: c.userId }) },
  { table: "ToolUse", delegate: "toolUse", by: "userId", where: (c) => ({ userId: c.userId }) },
  { table: "MemberAction", delegate: "memberAction", by: "userId / cartId", where: (c) => or({ userId: c.userId }, inList("cartId", c.cartIds)) },
  { table: "CartLine", delegate: "cartLine", by: "cartId", where: (c) => inList("cartId", c.cartIds) },
  { table: "Cart", delegate: "cart", by: "userId", where: (c) => ({ userId: c.userId }) },
  { table: "Subscription", delegate: "subscription", by: "userId", where: (c) => ({ userId: c.userId }) },
  { table: "Wallet", delegate: "wallet", by: "userId", where: (c) => ({ userId: c.userId }) },
  { table: "Transaction", delegate: "transaction", by: "userId (no FK) / ghlLocationId", where: (c) => or({ userId: c.userId }, inList("ghlLocationId", c.locationIds)) },
  { table: "Deal", delegate: "deal", by: "locationId (no FK)", where: (c) => inList("locationId", c.locationIds) },
  { table: "LandDeal", delegate: "landDeal", by: "locationId (no FK)", where: (c) => inList("locationId", c.locationIds) },
  { table: "GhlToken", delegate: "ghlToken", by: "locationId (no FK)", where: (c) => inList("locationId", c.locationIds) },
  { table: "WalletBalanceSnapshot", delegate: "walletBalanceSnapshot", by: "ghlAccountId / locationId (no FK)", where: (c) => or(c.accountId ? { ghlAccountId: c.accountId } : null, inList("locationId", c.locationIds)) },
  { table: "UsageRollup", delegate: "usageRollup", by: "ghlAccountId / scopeKey (no FK)", where: (c) => or(c.accountId ? { ghlAccountId: c.accountId } : null, inList("scopeKey", c.locationIds)) },
  { table: "WalletTransaction", delegate: "walletTransaction", by: "ghlAccountId / scopeKey (no FK)", where: (c) => or(c.accountId ? { ghlAccountId: c.accountId } : null, inList("scopeKey", c.locationIds)) },
  { table: "DunningDecision", delegate: "dunningDecision", by: "ghlAccountId", where: (c) => (c.accountId ? { ghlAccountId: c.accountId } : null) },
  { table: "GhlIntent", delegate: "ghlIntent", by: "ghlAccountId (no FK)", where: (c) => (c.accountId ? { ghlAccountId: c.accountId } : null) },
  { table: "BillingLedgerEntry", delegate: "billingLedgerEntry", by: "ghlAccountId / contactId", where: (c) => or(c.accountId ? { ghlAccountId: c.accountId } : null, { contactId: c.contactId }) },
  { table: "GhlSubscriptionState", delegate: "ghlSubscriptionState", by: "contactId (no FK)", where: (c) => ({ contactId: c.contactId }) },
];
export const EVENT_TABLE = "GhlEvent (externalId = contact/transaction id, or payload mentions the contact)";

/** Models that reference User/GhlAccount and are handled: the registry, plus the two roots themselves. */
const HANDLED_MODELS = new Set([...SPECS.map((s) => s.table), "GhlAccount", "User", "GhlEvent"]);
/** A reference we deliberately do NOT delete across: refusing is the right answer. */
const REFUSED_MODELS: Record<string, string> = { AdminAction: "the user performed admin actions (AdminAction.adminUserId)" };

/** Schema-derived guard: every model with a relation field pointing at User or GhlAccount must be in the registry. Returns the unhandled ones. */
export function unexpectedReferences(models: readonly { name: string; fields: readonly { type: string; relationFromFields?: readonly string[] | null; relationName?: string }[] }[] = Prisma.dmmf.datamodel.models): string[] {
  const out: string[] = [];
  for (const m of models) {
    if (HANDLED_MODELS.has(m.name) || m.name in REFUSED_MODELS) continue;
    if (m.fields.some((f) => (f.type === "User" || f.type === "GhlAccount") && (f.relationFromFields?.length ?? 0) > 0)) out.push(m.name);
  }
  return out;
}

export type Refusal = { contactId: string; reason: string };
export type Plan =
  | { ok: false; refusal: Refusal }
  | { ok: true; ctx: Ctx; email: string | null; counts: { table: string; by: string; count: number }[]; total: number };

type Db = Pick<PrismaClient, "user" | "ghlAccount" | "toolUse" | "cart" | "billingLedgerEntry" | "adminAction" | "$queryRaw"> & Record<string, any>;

const refuse = (contactId: string, reason: string): Plan => ({ ok: false, refusal: { contactId, reason } });

async function eventIds(db: Db, ctx: Ctx): Promise<string[]> {
  const ext = [ctx.contactId, ...ctx.ledgerTxnIds];
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "GhlEvent" WHERE "externalId" = ANY(${ext}) OR payload::text LIKE ${"%" + ctx.contactId + "%"}`;
  return rows.map((r) => r.id);
}

/** Resolve a contact to its User/GhlAccount, apply the safety checks, and count every dependent row. Read-only. */
export async function planRemoval(db: Db, contactId: string): Promise<Plan> {
  if (!/^[A-Za-z0-9]{8,64}$/.test(contactId)) return refuse(contactId, "not a valid GHL contact id");
  const account = await db.ghlAccount.findUnique({ where: { contactId }, select: { id: true, userId: true, accountType: true, locationId: true } });
  const users = await db.user.findMany({ where: { ghlContactId: contactId }, select: { id: true, email: true, role: true, ghlLocationId: true } });
  if (!account && users.length === 0) return refuse(contactId, "no User or GhlAccount for this contact");
  if (users.length > 1) return refuse(contactId, `${users.length} Users share this ghlContactId — ambiguous`);
  let user: (typeof users)[number] | undefined = users[0];
  if (account && user && account.userId !== user.id) return refuse(contactId, "the GhlAccount belongs to a different User than the one holding this ghlContactId — inconsistent");
  if (!user && account) {
    user = (await db.user.findUnique({ where: { id: account.userId }, select: { id: true, email: true, role: true, ghlLocationId: true } })) ?? undefined;
    if (!user) return refuse(contactId, "GhlAccount references a missing User");
  }
  if (!user) return refuse(contactId, "no User");
  if (user.role !== "user") return refuse(contactId, `User role is "${user.role}", not a plain member`);
  if (account && account.accountType !== "member") return refuse(contactId, `GhlAccount accountType is "${account.accountType}", not member`);
  if ((await db.adminAction.count({ where: { adminUserId: user.id } })) > 0) return refuse(contactId, REFUSED_MODELS.AdminAction);

  const locationIds = [...new Set([account?.locationId, user.ghlLocationId].filter((x): x is string => !!x))];
  const accountId = account?.id ?? null;
  const ledgerWhere: Where = { OR: [...(accountId ? [{ ghlAccountId: accountId }] : []), { contactId }] };

  const money = await db.billingLedgerEntry.aggregate({ where: { ...ledgerWhere, status: "succeeded", amount: { gt: 0 } }, _count: { _all: true }, _sum: { amount: true } });
  if (money._count._all > 0) return refuse(contactId, `money moved: ${money._count._all} succeeded BillingLedgerEntry row(s) with amount > 0 (sum ${money._sum.amount}) — not removed`);

  const [toolUses, carts, ledger] = await Promise.all([
    db.toolUse.findMany({ where: { userId: user.id }, select: { id: true } }),
    db.cart.findMany({ where: { userId: user.id }, select: { id: true } }),
    db.billingLedgerEntry.findMany({ where: ledgerWhere, select: { ghlTransactionId: true } }),
  ]);
  const ctx: Ctx = { contactId, userId: user.id, accountId, locationIds, toolUseIds: toolUses.map((t: { id: string }) => t.id), cartIds: carts.map((c: { id: string }) => c.id), ledgerTxnIds: ledger.map((l: { ghlTransactionId: string }) => l.ghlTransactionId) };

  const counts: { table: string; by: string; count: number }[] = [];
  for (const s of SPECS) {
    const where = s.where(ctx);
    counts.push({ table: s.table, by: s.by, count: where ? await db[s.delegate].count({ where }) : 0 });
  }
  counts.push({ table: EVENT_TABLE, by: "externalId / payload", count: (await eventIds(db, ctx)).length });
  counts.push({ table: "GhlAccount", by: "contactId", count: account ? 1 : 0 });
  counts.push({ table: "User", by: "id", count: 1 });
  return { ok: true, ctx, email: user.email, counts, total: counts.reduce((n, c) => n + c.count, 0) };
}

/**
 * Delete everything a plan counted, children first, inside the caller's transaction (`tx`). Throws — so the caller's transaction rolls
 * back — on any schema reference the registry does not know, or if rows remain after the deletes.
 */
export async function executeRemoval(tx: Db, ctx: Ctx): Promise<{ table: string; deleted: number }[]> {
  const unknown = unexpectedReferences();
  if (unknown.length) throw new Error(`schema has unhandled references to User/GhlAccount: ${unknown.join(", ")}`);
  const out: { table: string; deleted: number }[] = [];
  for (const s of SPECS) {
    const where = s.where(ctx);
    out.push({ table: s.table, deleted: where ? (await tx[s.delegate].deleteMany({ where })).count : 0 });
  }
  const ids = await eventIds(tx, ctx);
  out.push({ table: EVENT_TABLE, deleted: ids.length ? (await tx.ghlEvent.deleteMany({ where: { id: { in: ids } } })).count : 0 });
  out.push({ table: "GhlAccount", deleted: ctx.accountId ? (await tx.ghlAccount.deleteMany({ where: { id: ctx.accountId } })).count : 0 });
  out.push({ table: "User", deleted: (await tx.user.deleteMany({ where: { id: ctx.userId } })).count });

  // Nothing may remain (the DB's FKs already forbid orphaning a formal reference; this catches the no-FK tables).
  for (const s of SPECS) {
    const where = s.where(ctx);
    if (where && (await tx[s.delegate].count({ where })) > 0) throw new Error(`rows remain in ${s.table} after deletion — aborting`);
  }
  if ((await eventIds(tx, ctx)).length > 0) throw new Error("GhlEvent rows remain after deletion — aborting");
  if (out[out.length - 1].deleted !== 1) throw new Error("User row was not deleted — aborting");
  return out;
}
