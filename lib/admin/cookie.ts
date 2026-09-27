import { cookies, headers } from "next/headers";
import { ADMIN_BASE_HEADER, ADMIN_COOKIE, adminCookieOptions } from "./config";
import { signAdminSession, type AdminSessionPayload } from "./session";

export async function adminBase(): Promise<string> {
  return (await headers()).get(ADMIN_BASE_HEADER) ?? "";
}

export async function establishAdminSession(payload: AdminSessionPayload): Promise<void> {
  const token = await signAdminSession(payload);
  const host = (await headers()).get("host") ?? "";
  (await cookies()).set(ADMIN_COOKIE, token, adminCookieOptions(host));
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}
