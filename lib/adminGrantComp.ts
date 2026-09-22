// Read-only data for the dossier's grant/comp panel (v1.5 slice 3, §6b
// admin-direct exception). Available balance = Wallet.balance − sum(open
// CreditHolds) per §7. Recent-actions log lets an admin see prior
// admin_grant/subscription_comp AdminActions before granting again — same
// admin-eyes AdminAction table every other dossier write reads from, no new
// model.

import type { PrismaClient } from "@prisma/client";

export interface GrantCompContext {
  walletBalance: number;
  availableBalance: number;
}

export interface RecentGrantCompAction {
  id: string;
  action: "credit_grant" | "subscription_comp";
  note: string | null;
  createdAt: string;
  adminName: string;
}

export async function getGrantCompContext(db: PrismaClient, userId: string): Promise<GrantCompContext> {
  const [wallet, openHolds] = await Promise.all([
    db.wallet.findUnique({ where: { userId }, select: { balance: true } }),
    db.creditHold.aggregate({ where: { userId, state: "open" }, _sum: { reservedCredits: true } }),
  ]);

  const walletBalance = wallet?.balance ?? 0;
  const reserved = openHolds._sum.reservedCredits ?? 0;
  return { walletBalance, availableBalance: walletBalance - reserved };
}

export async function getRecentGrantCompActions(db: PrismaClient, userId: string, take = 10): Promise<RecentGrantCompAction[]> {
  const rows = await db.adminAction.findMany({
    where: { targetType: "user", targetId: userId, action: { in: ["credit_grant", "subscription_comp"] } },
    orderBy: { createdAt: "desc" },
    take,
    include: { adminUser: { select: { email: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    action: r.action as "credit_grant" | "subscription_comp",
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    adminName: r.adminUser.email,
  }));
}
