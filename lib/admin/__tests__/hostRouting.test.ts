import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { ADMIN_BASE_HEADER, ADMIN_COOKIE } from "../config";
import { isAdminContextHost, isPublicAdminPath, resolveAdminRoute } from "../hostRouting";
import { signAdminSession } from "../session";
import { TEST_ENV } from "./fakeDb";

const prod = { VERCEL_ENV: "production", ADMIN_PATH_ACCESS: "true" };
const preview = { VERCEL_ENV: "preview", ADMIN_PATH_ACCESS: "true" };

describe("resolveAdminRoute", () => {
  it("admin host (exact) and the dev host", () => {
    expect(resolveAdminRoute({ host: "admin.reiblast.app", pathname: "/health", env: {} }).kind).toBe("admin-host");
    expect(resolveAdminRoute({ host: "ADMIN.reiblast.app:443", pathname: "/", env: {} }).kind).toBe("admin-host");
    expect(resolveAdminRoute({ host: "admin.localhost:3000", pathname: "/login", env: {} }).kind).toBe("admin-host");
  });
  it("look-alike hosts are not admin hosts", () => {
    for (const host of ["admin.reiblast.app.evil.com", "xadmin.reiblast.app", "admin.reiblast.com", "reiblast.app", "tools.reiblast.app", "localhost:3000"])
      expect(resolveAdminRoute({ host, pathname: "/", env: {} }).kind).toBe("none");
  });
  it("/admin on other hosts is blocked (all envs but preview+flag)", () => {
    for (const host of ["reiblast.app", "tools.reiblast.app", "localhost:3001", "x.vercel.app"]) {
      expect(resolveAdminRoute({ host, pathname: "/admin", env: {} }).kind).toBe("blocked");
      expect(resolveAdminRoute({ host, pathname: "/admin/health", env: prod }).kind).toBe("blocked"); // flag set but PRODUCTION
      expect(resolveAdminRoute({ host, pathname: "/admin/health", env: { VERCEL_ENV: "preview" } }).kind).toBe("blocked"); // preview, no flag
      expect(resolveAdminRoute({ host, pathname: "/admin/health", env: { VERCEL_ENV: "preview", ADMIN_PATH_ACCESS: "false" } }).kind).toBe("blocked");
      expect(resolveAdminRoute({ host, pathname: "/admin/health", env: { VERCEL_ENV: "development", ADMIN_PATH_ACCESS: "true" } }).kind).toBe("blocked");
    }
    expect(resolveAdminRoute({ host: "reiblast.app", pathname: "/administrators", env: {} }).kind).toBe("none"); // not the /admin segment
  });
  it("preview + flag serves /admin by path", () => {
    expect(resolveAdminRoute({ host: "x-git-pipeline.vercel.app", pathname: "/admin/health", env: preview }).kind).toBe("preview-path");
    expect(resolveAdminRoute({ host: "x-git-pipeline.vercel.app", pathname: "/pricing", env: preview }).kind).toBe("none");
  });
  it("isAdminContextHost and public paths", () => {
    expect(isAdminContextHost("admin.reiblast.app", {})).toBe(true);
    expect(isAdminContextHost("reiblast.app", prod)).toBe(false);
    expect(isAdminContextHost("x.vercel.app", preview)).toBe(true);
    expect(["/login", "/enter", "/enter/x"].every(isPublicAdminPath)).toBe(true);
    expect(["/", "/health", "/loginx"].some(isPublicAdminPath)).toBe(false);
  });
});

const saved = { ...process.env };
function setEnv(env: Record<string, string | undefined>) {
  Object.assign(process.env, TEST_ENV, env);
  for (const k of ["VERCEL_ENV", "ADMIN_PATH_ACCESS"]) if (!(k in env)) delete process.env[k];
}
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const req = (host: string, path: string, cookie?: string) => new NextRequest(`https://${host}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } });
const rewrite = (res: Response) => res.headers.get("x-middleware-rewrite");
const validCookie = async () => `${ADMIN_COOKIE}=${await signAdminSession({ sub: "acct_owner", locationId: "LOC_HQ", method: "sms" }, TEST_ENV)}`;

describe("middleware: admin host", () => {
  it("public /login and /enter rewrite under /admin without a session", async () => {
    setEnv({});
    expect(rewrite(await middleware(req("admin.reiblast.app", "/login")))).toBe("https://admin.reiblast.app/admin/login");
    expect(rewrite(await middleware(req("admin.reiblast.app", "/enter?locationId=LOC_HQ")))).toBe("https://admin.reiblast.app/admin/enter?locationId=LOC_HQ");
  });
  it("protected paths redirect to /login with no or a bad cookie", async () => {
    setEnv({});
    for (const cookie of [undefined, `${ADMIN_COOKIE}=garbage`]) {
      const res = await middleware(req("admin.reiblast.app", "/health", cookie));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("https://admin.reiblast.app/login");
    }
  });
  it("with a valid session: / → /admin, /health → /admin/health, base header empty, noindex", async () => {
    setEnv({});
    const c = await validCookie();
    const home = await middleware(req("admin.reiblast.app", "/", c));
    expect(rewrite(home)).toBe("https://admin.reiblast.app/admin");
    expect(home.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(rewrite(await middleware(req("admin.reiblast.app", "/health", c)))).toBe("https://admin.reiblast.app/admin/health");
    expect(home.headers.get("x-middleware-request-" + ADMIN_BASE_HEADER)).toBe("");
  });
  it("the dev host behaves the same", async () => {
    setEnv({});
    expect(rewrite(await middleware(req("admin.localhost:3000", "/login")))).toBe("https://admin.localhost:3000/admin/login");
  });
  it("fails closed when ADMIN_SESSION_SECRET is missing: a cookie can't authenticate", async () => {
    setEnv({});
    const c = await validCookie();
    delete process.env.ADMIN_SESSION_SECRET;
    expect((await middleware(req("admin.reiblast.app", "/health", c))).status).toBe(307);
  });
});

describe("middleware: /admin on every other host is 404", () => {
  it("marketing, tools and localhost hosts, in production", async () => {
    setEnv({ VERCEL_ENV: "production", ADMIN_PATH_ACCESS: "true" });
    for (const host of ["reiblast.app", "www.reiblast.app", "tools.reiblast.app", "localhost:3001", "x.vercel.app"])
      for (const path of ["/admin", "/admin/health", "/admin/login"]) expect((await middleware(req(host, path))).status).toBe(404);
  });
  it("preview WITHOUT the flag is 404", async () => {
    setEnv({ VERCEL_ENV: "preview" });
    expect((await middleware(req("x.vercel.app", "/admin/health"))).status).toBe(404);
  });
});

describe("middleware: preview flag", () => {
  it("preview + ADMIN_PATH_ACCESS: public path passes through, protected redirects to /admin/login, session passes with base /admin", async () => {
    setEnv({ VERCEL_ENV: "preview", ADMIN_PATH_ACCESS: "true" });
    const login = await middleware(req("x.vercel.app", "/admin/login"));
    expect(login.status).toBe(200);
    expect(login.headers.get("x-middleware-next")).toBe("1");
    const denied = await middleware(req("x.vercel.app", "/admin/health"));
    expect(denied.status).toBe(307);
    expect(denied.headers.get("location")).toBe("https://x.vercel.app/admin/login");
    const ok = await middleware(req("x.vercel.app", "/admin/health", await validCookie()));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    expect(ok.headers.get("x-middleware-request-" + ADMIN_BASE_HEADER)).toBe("/admin");
  });
});

describe("middleware: existing hosts unchanged", () => {
  it("marketing pages rewrite to /marketing; tools /enter rewrites to /tools/enter", async () => {
    setEnv({});
    expect(rewrite(await middleware(req("reiblast.app", "/pricing")))).toBe("https://reiblast.app/marketing/pricing");
    expect(rewrite(await middleware(req("tools.reiblast.app", "/enter?locationId=x")))).toBe("https://tools.reiblast.app/tools/enter?locationId=x");
  });
});
