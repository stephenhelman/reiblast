// Member lookup data layer (/admin/members, /admin/members/[id]) — CLIENT-EYES.
// This surface shows exactly what the member sees of their own account: their
// subscriptions (with derived bundle status), wallet balance, status, and
// ledger history. NO company cost / vendorCost / margin here — see
// prisma/schema.prisma's ApiCall/LedgerEntry comments for the locked split.
// ToolUse/ApiCall carry isAdmin (admin-eyes filter); LedgerEntry rows are
// never written for admin runs, so this surface is naturally admin-free
// without needing its own filter.

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { qualifyBundle, type QualifyingTiers } from "@/lib/bundleQualify";
import { deriveTierName } from "@/lib/catalogDerive";

export type MemberListRow = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  role: string;
  onboardingStage: string | null;
  walletBalance: number | null;
  hasPastDueSub: boolean;
};

export async function listMembers(search: string, db: PrismaClient = defaultPrisma): Promise<MemberListRow[]> {
  const users = await db.user.findMany({
    where: search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { businessName: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      wallet: { select: { balance: true } },
      subscriptions: { select: { status: true } },
    },
    take: 200,
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    role: u.role,
    onboardingStage: u.onboardingStage,
    walletBalance: u.wallet?.balance ?? null,
    hasPastDueSub: u.subscriptions.some((s) => s.status === "past_due"),
  }));
}

export type MemberSubscriptionRow = {
  id: string;
  featureSlug: string;
  displayName: string;
  status: string;
  periodStart: string;
  periodEnd: string;
};

export type MemberLedgerRow = {
  id: string;
  kind: string;
  creditDelta: number;
  createdAt: string;
  reason: string | null;
  outcome: string | null;
  featureSlug: string | null;
  toolName: string | null;
  unitCount: number | null;
  allowanceCovered: boolean | null;
};

export type MemberDetail = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  role: string;
  onboardingStage: string | null;
  businessName: string | null;
  createdAt: string;
  walletBalance: number | null;
  subscriptions: MemberSubscriptionRow[];
  currentBundleSlug: string | null;
  ledger: MemberLedgerRow[];
};

export async function getMemberDetail(userId: string, db: PrismaClient = defaultPrisma): Promise<MemberDetail | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      wallet: { select: { balance: true } },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        include: { tier: { include: { feature: true } } },
      },
      ledgerEntries: {
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { tool: { select: { name: true } }, feature: { select: { slug: true } } },
      },
    },
  });
  if (!user) return null;

  const subscriptions: MemberSubscriptionRow[] = user.subscriptions.map((s) => ({
    id: s.id,
    featureSlug: s.tier.feature.slug,
    displayName: deriveTierName(s.tier.feature.unifiedName ?? s.tier.feature.slug, s.tier),
    status: s.status,
    periodStart: s.periodStart.toISOString(),
    periodEnd: s.periodEnd.toISOString(),
  }));

  // Derived bundle status — never re-derive the qualification rule itself,
  // just feed active tier levels into the shared bundleQualify() contract.
  const tiers: QualifyingTiers = {};
  for (const s of user.subscriptions) {
    if (s.status !== "active") continue;
    const slug = s.tier.feature.slug;
    if (slug !== "score" && slug !== "ask" && slug !== "bots") continue;
    tiers[slug] = s.tier.level;
  }
  const currentBundleSlug = qualifyBundle(tiers);

  const ledger: MemberLedgerRow[] = user.ledgerEntries.map((l) => ({
    id: l.id,
    kind: l.kind,
    creditDelta: l.creditDelta,
    createdAt: l.createdAt.toISOString(),
    reason: l.reason,
    outcome: l.outcome,
    featureSlug: l.feature?.slug ?? null,
    toolName: l.tool?.name ?? null,
    unitCount: l.unitCount,
    allowanceCovered: l.allowanceCovered,
  }));

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    role: user.role,
    onboardingStage: user.onboardingStage,
    businessName: user.businessName,
    createdAt: user.createdAt.toISOString(),
    walletBalance: user.wallet?.balance ?? null,
    subscriptions,
    currentBundleSlug,
    ledger,
  };
}
