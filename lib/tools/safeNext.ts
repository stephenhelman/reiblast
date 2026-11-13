/**
 * Where /enter may send a member after a successful OTP. EXACT match against this list — never a prefix, never a URL — so the `next`
 * param can't be turned into an open redirect or reach an unlisted internal path.
 */
export const TOOLS_NEXT_ALLOWLIST: readonly string[] = ["/scorecard"];

export function safeNext(raw: unknown): string | null {
  return typeof raw === "string" && TOOLS_NEXT_ALLOWLIST.includes(raw) ? raw : null;
}
