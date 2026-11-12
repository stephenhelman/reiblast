import type { PrismaClient } from "@prisma/client";

/**
 * Campaign SMS stats (POST /api/webhooks/campaign-event). Pure parsing + the atomic counter upsert; the route and the
 * campaign_snapshot job both build on this. No per-contact rows are ever stored: one CampaignStats row per
 * (location, list, variant), counters only. Blank list/variant values are stored as "" (never null) because Postgres treats
 * NULLs as distinct in a unique constraint.
 */

export const CAMPAIGN_EVENTS = ["entered", "replied", "errored", "no_response"] as const;
export type CampaignEvent = (typeof CAMPAIGN_EVENTS)[number];

/** Same shape rule as the stage-changed contactId check (lib/billing/events/stageChanged.ts): 8–64 alphanumeric chars. */
export const GHL_ID_RE = /^[A-Za-z0-9]{8,64}$/;

/** The contact tag that says which SMS step a reply/error belongs to: "SMS 1" … "SMS 7", case-insensitive. */
export const STEP_TAG_RE = /^sms ([1-7])$/i;

export const MAX_LIST_TYPE = 100;
export const MAX_LIST_NAME = 200;
export const MAX_VARIANT = 100;

export const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Every integer counter on CampaignStats / CampaignSnapshot, in column order. */
export const COUNTER_FIELDS = [
  "entered", "replied", "errored", "noResponse",
  ...STEPS.map((n) => `replied${n}` as const),
  ...STEPS.map((n) => `errored${n}` as const),
] as const;
export type CounterField = (typeof COUNTER_FIELDS)[number];

const TOTAL_FIELD: Record<CampaignEvent, CounterField> = { entered: "entered", replied: "replied", errored: "errored", no_response: "noResponse" };

export type CampaignKey = { locationId: string; listType: string; listName: string; variant: string };
export type ParsedCampaignEvent = CampaignKey & { event: CampaignEvent };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const customData = (body: Obj): Obj | null => (isObj(body.customData) ? body.customData : null);

/** Custom Data only (no flat fallback — GHL's own top-level fields must never be mistaken for ours). Non-string / blank → "". */
export function customDataString(body: Obj, key: string): string {
  const v = customData(body)?.[key];
  return typeof v === "string" ? v.trim() : "";
}

export function parseCampaignPayload(body: Obj): { ok: true; value: ParsedCampaignEvent } | { ok: false; reason: "invalid_location" | "invalid_event" } {
  const locationId = customDataString(body, "locationId");
  if (!GHL_ID_RE.test(locationId)) return { ok: false, reason: "invalid_location" };
  const event = customDataString(body, "event").toLowerCase();
  if (!(CAMPAIGN_EVENTS as readonly string[]).includes(event)) return { ok: false, reason: "invalid_event" };
  return {
    ok: true,
    value: {
      locationId,
      event: event as CampaignEvent,
      listType: customDataString(body, "listType").slice(0, MAX_LIST_TYPE),
      listName: customDataString(body, "listName").slice(0, MAX_LIST_NAME),
      variant: customDataString(body, "variant").slice(0, MAX_VARIANT),
    },
  };
}

/** Accepts an array of tags or a comma-separated string. Anything else → null. */
export function normalizeTags(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map((t) => t.trim()).filter(Boolean);
  return null;
}

let shapeLogged = false;
/** The contact's tags from GHL's standard webhook payload (top-level `tags`, then `contact.tags`, then customData.tags). null = none found. */
export function extractTags(body: Obj): string[] | null {
  const candidates = [body.tags, isObj(body.contact) ? body.contact.tags : undefined, customData(body)?.tags];
  for (const c of candidates) {
    const t = normalizeTags(c);
    if (t) return t;
  }
  if (process.env.NODE_ENV !== "production" && !shapeLogged) {
    shapeLogged = true; // once per process; key names and types only — never values
    const shape = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? "array" : v === null ? "null" : typeof v]));
    console.log("[campaign-event] no tags found in payload; shape:", JSON.stringify(shape));
  }
  return null;
}

/** Exactly one distinct "SMS n" tag → n; none or several → null (count the total only). */
export function stepFromTags(tags: readonly string[] | null): number | null {
  if (!tags) return null;
  const steps = new Set<number>();
  for (const t of tags) {
    const m = STEP_TAG_RE.exec(t);
    if (m) steps.add(Number(m[1]));
  }
  return steps.size === 1 ? [...steps][0] : null;
}

/** Step only applies to replies and errors. */
export function stepForEvent(event: CampaignEvent, body: Obj): number | null {
  return event === "replied" || event === "errored" ? stepFromTags(extractTags(body)) : null;
}

/** The counter columns one event bumps: the total, plus the step column for replied/errored with a known step. */
export function fieldsToBump(event: CampaignEvent, step: number | null): CounterField[] {
  const out: CounterField[] = [TOTAL_FIELD[event]];
  if (step !== null && (event === "replied" || event === "errored")) out.push(`${event}${step}` as CounterField);
  return out;
}

const isUniqueViolation = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

type StatsDb = Pick<PrismaClient, "campaignStats">;

/** One atomic upsert per event (create at 1 / update with increment). A create race on the unique key (P2002) retries once as an update. */
export async function recordCampaignEvent(db: StatsDb, e: ParsedCampaignEvent, step: number | null, now: Date): Promise<void> {
  const where = { locationId_listType_listName_variant: { locationId: e.locationId, listType: e.listType, listName: e.listName, variant: e.variant } };
  const fields = fieldsToBump(e.event, step);
  const ones = Object.fromEntries(fields.map((f) => [f, 1]));
  const incs = Object.fromEntries(fields.map((f) => [f, { increment: 1 }]));
  const create = { locationId: e.locationId, listType: e.listType, listName: e.listName, variant: e.variant, firstEventAt: now, lastEventAt: now, ...ones };
  const update = { lastEventAt: now, ...incs };
  try {
    await db.campaignStats.upsert({ where, create, update });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await db.campaignStats.update({ where, data: update });
  }
}
