import { NextRequest, NextResponse } from "next/server";
import { checkSecret, missingEnvVars, type Reason } from "@/lib/billing/reason";

/**
 * Shared shell for the bot-facing Discord endpoints: secret check (timing-safe, header x-reiblast-discord-secret vs
 * DISCORD_BOT_INBOUND_SECRET), JSON-object body, always HTTP 200 with a reason. Logs reason codes only — never emails, phone
 * numbers, codes, Discord ids or secrets. An unexpected exception logs its class and Prisma code only: err.message and the stack are
 * never logged, because a database error's message can embed the query arguments (a Discord id, an email).
 * `run` receives the parsed body and returns the response payload (or null → bad_request).
 */
export async function runDiscordEndpoint(
  req: NextRequest,
  label: string,
  run: (body: Record<string, unknown>) => Promise<{ result: string; reason: Reason; [k: string]: unknown } | null>,
): Promise<NextResponse> {
  const reply = (body: { result: string; reason: Reason; [k: string]: unknown }) => {
    console.log(`[${label}] reason=${body.reason}`);
    return NextResponse.json(body);
  };
  const error = (reason: Reason) => reply({ result: "error", reason });
  try {
    const auth = checkSecret(req.headers.get("x-reiblast-discord-secret"), "DISCORD_BOT_INBOUND_SECRET");
    if (auth === "misconfigured") {
      console.error(`[${label}] missing required env var(s):`, missingEnvVars(["DISCORD_BOT_INBOUND_SECRET"]).join(", "));
      return error("server_misconfigured");
    }
    if (auth === "missing") return error("auth_missing");
    if (auth === "failed") return error("auth_failed");

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return error("bad_json");
    }

    const out = await run(body);
    return out ? reply(out) : error("bad_request");
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown } | null;
    console.error(`[${label}] internal error reason=internal_error name=${typeof e?.name === "string" ? e.name : "unknown"} code=${typeof e?.code === "string" ? e.code : "-"}`);
    return error("internal_error");
  }
}
