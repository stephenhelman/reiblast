import { apiStats } from "../ghlWallet";
import type { SubscriptionInfo } from "./types";
import { TRIAL_OFFER_RE } from "./types";

/** Local wall-clock time in an IANA zone → UTC instant (DST-aware). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time || "00:00:00");
  if (!m || !t) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], +(t[3] ?? 0));
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return null;
  }
  const offset = (utc: number) => {
    const o: Record<string, number> = {};
    for (const p of fmt.formatToParts(new Date(utc))) if (p.type !== "literal") o[p.type] = Number(p.value);
    return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(utc / 1000) * 1000;
  };
  let x = guess - offset(guess);
  x = guess - offset(x);
  return new Date(x);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const date = (v: unknown): Date | null => {
  const s = str(v);
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * Trial info from a GHL subscription in EITHER shape: the list shape (`entitySourceName`, `trialEndDate`) or the single-record
 * shape (`entitySource.name`; the first billing date — the end of the trial — is `schedule.rrule.startDate` + `startTime` in
 * `timezone`). The end date is only derived from the schedule for a trialing subscription or a "N Day Trial" name.
 */
export function parseSubscription(input: unknown): SubscriptionInfo | null {
  const r = isObj(input) && isObj(input.data) ? input.data : input;
  if (!isObj(r)) return null;
  const name = str(isObj(r.entitySource) ? r.entitySource.name : null) ?? str(r.entitySourceName);
  let trialEndsAt = date(r.trialEndDate);
  if (!trialEndsAt && (r.status === "trialing" || (name && TRIAL_OFFER_RE.test(name)))) {
    const rrule = isObj(r.schedule) && isObj(r.schedule.rrule) ? r.schedule.rrule : null;
    const start = rrule ? str(rrule.startDate) : null;
    if (rrule && start) trialEndsAt = zonedToUtc(start, str(rrule.startTime) ?? "00:00:00", str(rrule.timezone) ?? "America/Denver");
  }
  return { name, trialEndsAt };
}

/** Read-only fetch of one subscription (HQ key). Returns null when it can't be read. */
export async function fetchSubscription(subscriptionId: string): Promise<SubscriptionInfo | null> {
  const token = process.env.GHL_HQ_API_KEY;
  const locationId = process.env.GHL_HQ_LOCATION_ID;
  if (!token || !locationId || !/^[A-Za-z0-9]{10,64}$/.test(subscriptionId)) return null;
  apiStats.calls++;
  const res = await fetch(`https://services.leadconnectorhq.com/payments/subscriptions/${subscriptionId}?altId=${encodeURIComponent(locationId)}&altType=location`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" },
  });
  if (!res.ok) return null;
  return parseSubscription(await res.json());
}
