// PREVIEW-ONLY SCAFFOLDING — mirrors config/launcher.mock.ts / config/store.mock.ts.
// Gated behind TOOLS_PREVIEW_MOCK_MEMBER in lib/accountData.ts; never read by
// the real (Prisma) path. Seeds ledger rows covering every visual row type
// (funding, credit-debit, allowance-covered) plus a past_due subscription so
// the dunning state and the filter bar can be checked without hand-inserting
// rows into a dev database.

import type { AccountData, AccountLedgerRow } from "@/types/account";

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

// Ascending-chronology deltas, oldest first, so balanceAfter reads naturally —
// then reversed at the end to match the real accessor's most-recent-first order.
const rawRows: Omit<AccountLedgerRow, "balanceAfter">[] = [
  {
    id: "mock-1",
    kind: "funding",
    createdAt: daysAgo(28),
    toolBrandSlug: null,
    toolName: null,
    activityLabel: null,
    reasonLabel: "Plan grant",
    refId: null,
    featureSlug: "score",
    outcome: null,
    allowanceCovered: false,
    creditDelta: 0,
    searchText: "plan grant",
  },
  {
    id: "mock-2",
    kind: "allowance-covered",
    createdAt: daysAgo(25),
    toolBrandSlug: "rei-score",
    toolName: "REIscore",
    activityLabel: "1 analyses",
    reasonLabel: null,
    refId: null,
    featureSlug: "score",
    outcome: "success",
    allowanceCovered: true,
    creditDelta: 0,
    searchText: "reiscore",
  },
  {
    id: "mock-3",
    kind: "funding",
    createdAt: daysAgo(20),
    toolBrandSlug: null,
    toolName: null,
    activityLabel: null,
    reasonLabel: "Credit pack purchase (pack-250)",
    refId: "pi_mock_1",
    featureSlug: null,
    outcome: null,
    allowanceCovered: false,
    creditDelta: 250,
    searchText: "credit pack purchase pack-250 pi_mock_1",
  },
  {
    id: "mock-4",
    kind: "credit-debit",
    createdAt: daysAgo(14),
    toolBrandSlug: "rei-ask",
    toolName: "REIask",
    activityLabel: "5 queries",
    reasonLabel: null,
    refId: null,
    featureSlug: "ask",
    outcome: "success",
    allowanceCovered: false,
    creditDelta: -1,
    searchText: "reiask",
  },
  {
    id: "mock-5",
    kind: "credit-debit",
    createdAt: daysAgo(10),
    toolBrandSlug: "rei-acq",
    toolName: "REIacq",
    activityLabel: "1 handoffs",
    reasonLabel: null,
    refId: null,
    featureSlug: "bots",
    outcome: "fail",
    allowanceCovered: false,
    creditDelta: 0,
    searchText: "reiacq",
  },
  {
    id: "mock-6",
    kind: "allowance-covered",
    createdAt: daysAgo(6),
    toolBrandSlug: "rei-score",
    toolName: "REIscore",
    activityLabel: "1 analyses",
    reasonLabel: null,
    refId: null,
    featureSlug: "score",
    outcome: "success",
    allowanceCovered: true,
    creditDelta: 0,
    searchText: "reiscore",
  },
  {
    id: "mock-7",
    kind: "credit-debit",
    createdAt: daysAgo(2),
    toolBrandSlug: "rei-pack",
    toolName: "REIpack",
    activityLabel: "3 packets",
    reasonLabel: null,
    refId: null,
    featureSlug: "pack",
    outcome: "success",
    allowanceCovered: false,
    creditDelta: -3,
    searchText: "reipack",
  },
];

function withRunningBalance(rows: Omit<AccountLedgerRow, "balanceAfter">[]): AccountLedgerRow[] {
  let running = 0;
  const withBalance = rows.map((row) => {
    running += row.creditDelta;
    return { ...row, balanceAfter: running };
  });
  return withBalance.reverse();
}

export const mockAccountData: AccountData = {
  member: {
    id: "preview-member",
    name: "Preview Member",
    email: "preview@example.com",
    walletBalance: 246,
  },
  meteredFeatures: [
    {
      featureSlug: "score",
      toolName: "REIscore",
      unit: "analyses",
      used: 6,
      allowance: 10,
      periodEnd: new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
  // A bundle member is N tool_sub rows now — Bundle Plus previewed here as
  // its two lines (score/plus + ask/base), grouped via currentBundleSlug
  // below rather than a fake per-row "bundle" kind.
  subscriptions: [
    {
      id: "mock-sub-score-plus",
      kind: "tool_sub",
      featureId: "mock-feature-score",
      displayName: "REIscore+",
      grants: ["50 included this period"],
      status: "active",
      periodEnd: new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString(),
      downgradeTarget: { tierId: "mock-tier-score-base", displayName: "REIscore", priceCents: 0 },
    },
    {
      id: "mock-sub-ask-base",
      kind: "tool_sub",
      featureId: "mock-feature-ask",
      displayName: "REIask",
      grants: ["500 included this period"],
      status: "past_due",
      periodEnd: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
      downgradeTarget: null,
    },
  ],
  currentBundleSlug: "bundle-plus",
  ledger: withRunningBalance(rawRows),
};
