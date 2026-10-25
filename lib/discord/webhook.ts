// Server -> Discord channel webhooks for promo posts. DISCORD_PROMO_WEBHOOKS is a server-only JSON map of channel key -> webhook
// URL (same read-at-request-time pattern as ARI_PROMO_CODES in lib/ariPromo.ts). URLs are secrets: never logged, never returned.

export type ChannelKey = "promo" | "announcements" | "ops";

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  image?: { url: string };
  footer?: { text: string };
}

export interface DiscordPayload {
  username?: string;
  content?: string;
  allowed_mentions?: { roles?: string[]; parse?: string[] };
  embeds?: DiscordEmbed[];
}

export type ChannelResolution =
  | { ok: true; url: string }
  | { ok: false; reason: "webhooks_not_configured" | "webhooks_invalid_json" | "webhook_missing" | "webhook_url_invalid" };

export function isDiscordWebhookUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      (u.hostname === "discord.com" || u.hostname === "discordapp.com") &&
      u.pathname.startsWith("/api/webhooks/") &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

/** Resolve a channel key from a raw JSON map (env var contents). Pure so the preview script can feed it the _TEST var. */
export function resolveChannelFrom(raw: string | undefined, key: ChannelKey): ChannelResolution {
  if (!raw?.trim()) return { ok: false, reason: "webhooks_not_configured" };
  let map: unknown;
  try {
    map = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "webhooks_invalid_json" };
  }
  if (typeof map !== "object" || map === null || Array.isArray(map)) return { ok: false, reason: "webhooks_invalid_json" };
  const url = (map as Record<string, unknown>)[key];
  if (url === undefined || url === null || url === "") return { ok: false, reason: "webhook_missing" };
  return isDiscordWebhookUrl(url) ? { ok: true, url } : { ok: false, reason: "webhook_url_invalid" };
}

export function resolveChannel(key: ChannelKey): ChannelResolution {
  return resolveChannelFrom(process.env.DISCORD_PROMO_WEBHOOKS, key);
}

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

/** POST with ?wait=true so Discord returns the message. 10s timeout. Errors are fixed codes — no response bodies, no URLs. */
export async function sendDiscordWebhook(url: string, payload: DiscordPayload): Promise<SendResult> {
  const target = new URL(url);
  target.searchParams.set("wait", "true");
  try {
    const res = await fetch(target.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return typeof json?.id === "string" ? { ok: true, messageId: json.id } : { ok: false, error: "bad_response" };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network" };
  }
}

/** Short plain-text alert to the "ops" channel, if configured. Best effort: never throws, carries no PII or URLs. */
export async function sendOpsAlert(text: string, rawMap: string | undefined = process.env.DISCORD_PROMO_WEBHOOKS): Promise<void> {
  const ops = resolveChannelFrom(rawMap, "ops");
  if (!ops.ok) return;
  await sendDiscordWebhook(ops.url, { username: "REIblast", content: text.slice(0, 500) });
}
