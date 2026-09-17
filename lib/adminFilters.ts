// Server-side Overview filters (Range, Source) — parsed from searchParams.
// These are the ONLY things that trigger a refetch; the lens toggle
// (Money/Users/Activity) is purely client-side over the already-loaded data.

export type RangeKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "billing_current"
  | "billing_previous"
  | "custom"
  | "all";

export type SourceFilter = "admin" | "client" | "both";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  billing_current: "This billing period",
  billing_previous: "Last billing period",
  custom: "Custom",
  all: "All time",
};

export const SOURCE_LABELS: Record<SourceFilter, string> = {
  admin: "Admin",
  client: "Client",
  both: "Both",
};

export type DateWindow = { start: Date | null; end: Date };

function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Calendar-month "billing period" approximation (UTC) — not the per-vendor anchor-day period used for Rentcast amortization, which stays independent of this filter. */
function calendarMonth(now: Date, monthsAgo: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));
  return { start, end };
}

export function resolveRange(range: RangeKey, now: Date, customFrom?: string, customTo?: string): DateWindow {
  switch (range) {
    case "today":
      return { start: startOfUTCDay(now), end: now };
    case "yesterday": {
      const end = startOfUTCDay(now);
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      return { start, end };
    }
    case "7d":
      return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now };
    case "30d":
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
    case "billing_current": {
      const { start } = calendarMonth(now, 0);
      return { start, end: now };
    }
    case "billing_previous": {
      const { start, end } = calendarMonth(now, 1);
      return { start, end };
    }
    case "custom": {
      const start = customFrom ? new Date(`${customFrom}T00:00:00.000Z`) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const end = customTo ? new Date(`${customTo}T23:59:59.999Z`) : now;
      return { start: Number.isNaN(start.getTime()) ? null : start, end: Number.isNaN(end.getTime()) ? now : end };
    }
    case "all":
      return { start: null, end: now };
    default:
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
  }
}

export function parseRange(value: string | undefined): RangeKey {
  const valid: RangeKey[] = ["today", "yesterday", "7d", "30d", "billing_current", "billing_previous", "custom", "all"];
  return valid.includes(value as RangeKey) ? (value as RangeKey) : "30d";
}

export function parseSource(value: string | undefined): SourceFilter {
  const valid: SourceFilter[] = ["admin", "client", "both"];
  return valid.includes(value as SourceFilter) ? (value as SourceFilter) : "both";
}

/** Usage-row (ToolUse/ApiCall) isAdmin filter — Source is USAGE-row based only, never applied to subscription-based data. */
export function sourceToIsAdminFilter(source: SourceFilter): { isAdmin: boolean } | undefined {
  if (source === "admin") return { isAdmin: true };
  if (source === "client") return { isAdmin: false };
  return undefined;
}
