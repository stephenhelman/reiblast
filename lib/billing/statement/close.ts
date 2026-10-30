import { addMonths, denverMonthStart } from "../reports/denver";

export type CloseCheck = { ok: true } | { ok: false; reason: string };

/** A month can be closed only after it has ended (Denver) AND its actual Kurv statement has been entered. */
export function canCloseMonth(i: { month: string; now: Date; hasKurvStatement: boolean; alreadyClosed: boolean }): CloseCheck {
  if (i.alreadyClosed) return { ok: false, reason: "This month is already closed." };
  if (i.now < denverMonthStart(addMonths(i.month, 1))) return { ok: false, reason: "The month hasn't ended yet." };
  if (!i.hasKurvStatement) return { ok: false, reason: "Enter the Kurv statement for this month first (Cash & Processor)." };
  return { ok: true };
}
