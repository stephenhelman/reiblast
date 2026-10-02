/**
 * Pure routing decision for the REIblast admin. Used by middleware.ts and by requireOwner's host check.
 *
 *  - admin host (admin.reiblast.app, or admin.localhost[:port] in dev) → rewrite everything to /admin/*
 *  - /admin/* on any other host → 404, EXCEPT on a Vercel preview with ADMIN_PATH_ACCESS=true (never in production)
 */
export const ADMIN_HOSTS = ["admin.reiblast.app", "admin.localhost"] as const;

export type AdminRoute = { kind: "admin-host" } | { kind: "preview-path" } | { kind: "blocked" } | { kind: "none" };

type Env = { VERCEL_ENV?: string; ADMIN_PATH_ACCESS?: string };

export const hostnameOf = (host: string): string => host.split(":")[0].trim().toLowerCase();
export const isAdminHost = (host: string): boolean => (ADMIN_HOSTS as readonly string[]).includes(hostnameOf(host));
export const isAdminPath = (pathname: string): boolean => pathname === "/admin" || pathname.startsWith("/admin/");
export const previewPathAccess = (env: Env): boolean => env.VERCEL_ENV === "preview" && env.ADMIN_PATH_ACCESS === "true";

export function resolveAdminRoute(input: { host: string; pathname: string; env: Env }): AdminRoute {
  if (isAdminHost(input.host)) return { kind: "admin-host" };
  if (!isAdminPath(input.pathname)) return { kind: "none" };
  return previewPathAccess(input.env) ? { kind: "preview-path" } : { kind: "blocked" };
}

/** Whether a request with this Host may be served admin content at all (used by requireOwner). */
export function isAdminContextHost(host: string, env: Env): boolean {
  return isAdminHost(host) || previewPathAccess(env);
}

/** Paths reachable without a session. `p` is the admin-relative path ("/login", "/enter"). */
export const isPublicAdminPath = (p: string): boolean => p === "/login" || p === "/enter" || p.startsWith("/login/") || p.startsWith("/enter/");
