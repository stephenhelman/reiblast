import type { BillingClass } from "@prisma/client";
import type { DunningEvent } from "./types";

export type LedgerEventInput = {
  ghlTransactionId: string;
  classification: BillingClass;
  status: string;
  ghlAccountId: string | null;
  occurredAt: Date;
  subscriptionId: string | null;
};

export type MappedEvent = { trigger: string; event: DunningEvent; eventAt: Date; subscriptionId: string | null };
export type MapResult = { ok: true; value: MappedEvent } | { ok: false; skip: string };

/**
 * Ledger row → engine event. Only TERMINAL statuses (succeeded / failed) produce one: a `pending` row is skipped WITHOUT
 * recording anything, so the (trigger, account, mode) unique key can't freeze a decision on a non-final status.
 * Rows the rules don't cover (failed_signup, unclassified, refunds, failed $0 auths) are skipped too.
 */
export function eventFromLedger(r: LedgerEventInput): MapResult {
  if (!r.ghlAccountId) return { ok: false, skip: "unmatched (no account)" };
  if (r.status !== "succeeded" && r.status !== "failed") return { ok: false, skip: `status ${r.status} is not terminal` };
  const trigger = `ledger:${r.ghlTransactionId}`;
  const done = r.status === "succeeded";
  const wrap = (event: DunningEvent): MapResult => ({ ok: true, value: { trigger, event, eventAt: r.occurredAt, subscriptionId: r.subscriptionId } });
  switch (r.classification) {
    case "wallet_auto_recharge":
    case "wallet_manual_recharge": {
      const wallet = r.classification === "wallet_auto_recharge" ? "auto" : "manual";
      return wrap({ kind: done ? "wallet_recharge_succeeded" : "wallet_recharge_failed", wallet });
    }
    case "core_subscription":
      return wrap({ kind: done ? "core_succeeded" : "core_failed" });
    case "trial_auth":
      return done ? wrap({ kind: "trial_auth_succeeded" }) : { ok: false, skip: "trial_auth failed: no rule" };
    default:
      return { ok: false, skip: `${r.classification}: no dunning rule` };
  }
}
