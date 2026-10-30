import { addMonths, denverMonthStart } from "../reports/denver";

export type CloseCheck = { ok: true } | { ok: false; reason: string };

export type WalletRefreshState = { windowsDone: number; windowsTotal: number; completedAt: Date | null } | null;

/**
 * A month can be closed only when ALL of: the month has ended (Denver), its GHL wallet month-refresh is complete (so the
 * wallet line is the whole month, not a partial pull), and the actual Kurv statement is entered.
 */
export function canCloseMonth(i: { month: string; now: Date; hasKurvStatement: boolean; alreadyClosed: boolean; walletRefresh: WalletRefreshState }): CloseCheck {
  if (i.alreadyClosed) return { ok: false, reason: "This month is already closed." };
  if (i.now < denverMonthStart(addMonths(i.month, 1))) return { ok: false, reason: "The month hasn't ended yet." };
  if (!i.walletRefresh?.completedAt) {
    const w = i.walletRefresh;
    return { ok: false, reason: w ? `The GHL wallet refresh for this month isn't complete (${w.windowsDone}/${w.windowsTotal} windows). It resumes on its own each time the wallet_month_refresh job runs.` : "The GHL wallet refresh for this month hasn't started (job wallet_month_refresh runs from the 2nd of the next month, UTC)." };
  }
  if (!i.hasKurvStatement) return { ok: false, reason: "Enter the Kurv statement for this month first (Cash & Processor)." };
  return { ok: true };
}
