/** Link builders. `base` is "" on the admin host and "/admin" in preview path mode (see middleware / x-admin-base). */
export type Q = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Q): string {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}
export const adminHref = (base: string, path: string, params: Q = {}): string => `${base}${path === "/" ? "" : path}${qs(params)}` || "/";
/** API routes are not under the admin base: they live at /api/admin/* on whatever host serves the page. */
export const exportHref = (view: string, params: Q = {}): string => `/api/admin/export/${view}${qs(params)}`;
