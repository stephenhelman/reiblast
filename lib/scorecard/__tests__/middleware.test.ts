import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { middleware } from "@/middleware";
import { signToolsSession } from "@/lib/toolsSession";
import { TOOLS_SESSION_COOKIE } from "@/lib/constants";

const HOST = "tools.reiblast.app";
const req = (path: string, cookie?: string, host = HOST) =>
  new NextRequest(`https://${host}${path}`, { headers: { host, ...(cookie ? { cookie: `${TOOLS_SESSION_COOKIE}=${cookie}` } : {}) } });
// Trailing slash ignored: a clone of a "/x/" request keeps its slash on the rewrite target; only WHERE it routes matters here.
const rewriteTarget = (res: Response) => new URL(res.headers.get("x-middleware-rewrite") ?? "http://none/").pathname.replace(/(.)\/$/, "$1");

beforeAll(() => { process.env.TOOLS_SESSION_SECRET = "t".repeat(40); });

describe("tools middleware: /scorecard/view exemption is exact", () => {
  it("/scorecard/view needs no session cookie; rewrites to the page; sends no-referrer + no-store + noindex", async () => {
    const res = await middleware(req("/scorecard/view?t=abc"));
    expect(rewriteTarget(res)).toBe("/tools/scorecard/view");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
  it("keeps the query (the token) on the rewritten URL", async () => {
    const res = await middleware(req("/scorecard/view?t=abc"));
    expect(new URL(res.headers.get("x-middleware-rewrite")!).searchParams.get("t")).toBe("abc");
  });
  it.each(["/scorecard", "/scorecard/", "/scorecard/view/", "/scorecard/view/x", "/scorecard/viewer", "/scorecard/view.json", "/scorecard/views", "/Scorecard/view", "/tools/scorecard/view", "/analyzer", "/widget/header", "/"])(
    "%s without a session is still gated (session-expired)", async (p) => {
      const res = await middleware(req(p));
      expect(rewriteTarget(res)).toBe("/tools/session-expired");
      expect(res.headers.get("Referrer-Policy")).toBeNull();
    });
  it("/scorecard with a valid tools session passes through to the tools page", async () => {
    const cookie = await signToolsSession({ userId: "u1", locationId: "LOCATION1234567890ab" });
    expect(rewriteTarget(await middleware(req("/scorecard", cookie)))).toBe("/tools/scorecard");
  });
  it("/enter is still the other open route", async () => {
    expect(rewriteTarget(await middleware(req("/enter?locationId=x")))).toBe("/tools/enter");
  });
  it("the exemption only applies on the tools host", async () => {
    const res = await middleware(req("/scorecard/view", undefined, "reiblast.app"));
    expect(rewriteTarget(res)).toBe("/marketing/scorecard/view");
    expect(res.headers.get("Referrer-Policy")).toBeNull();
  });
});
