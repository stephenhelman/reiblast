/** Edge-safe constants/helpers for the REIblast admin (owner-only; separate from the REItools admin). */

export const ADMIN_COOKIE = "reiblast_admin";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
/** Header set by middleware: "" on the admin host, "/admin" when served by path on a preview host. */
export const ADMIN_BASE_HEADER = "x-admin-base";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS = 3;
export const OTP_SEND_WINDOW_MS = 15 * 60 * 1000;
/** Blocks any login attempt after this many login_failed audit rows in the window (covers TOTP/backup, which have no challenge). */
export const LOGIN_FAIL_MAX = 10;
export const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
/** A page load within this long of the last send does not send again (mirrors the tools entry cooldown). */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** ADMIN_LOCATION_IDS: comma-separated GHL location ids allowed to open /admin/enter. */
export function adminLocationIds(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_LOCATION_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isDevAdminHost(host: string): boolean {
  return host.split(":")[0].toLowerCase() === "admin.localhost";
}

export function adminCookieOptions(host: string) {
  return {
    httpOnly: true,
    secure: !isDevAdminHost(host), // Safari drops Secure cookies on *.localhost; every real host is Secure
    sameSite: "strict" as const,
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    // no `domain`: host-only, never shared with other subdomains
  };
}
