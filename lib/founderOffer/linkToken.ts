import { SignJWT, jwtVerify } from "jose";

/** The signed claim link minted from Discord: it IS the member's identity on /founders/claim (no email is ever typed). */
export const FOUNDER_LINK_TTL_SECONDS = 30 * 60;
export type FounderLinkPayload = { ghlAccountId: string; discordUserId: string };

function secret(): Uint8Array {
  const s = process.env.FOUNDERS_LINK_SECRET;
  if (!s) throw new Error("FOUNDERS_LINK_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signFounderLink(p: FounderLinkPayload): Promise<string> {
  return new SignJWT({ ghlAccountId: p.ghlAccountId, discordUserId: p.discordUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience("founders-link")
    .setExpirationTime(`${FOUNDER_LINK_TTL_SECONDS}s`)
    .sign(secret());
}

/** Null for anything not a currently-valid link token (bad signature, expired, wrong audience, malformed, secret unset). */
export async function verifyFounderLink(token: string): Promise<FounderLinkPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], audience: "founders-link" });
    return typeof payload.ghlAccountId === "string" && typeof payload.discordUserId === "string" ? { ghlAccountId: payload.ghlAccountId, discordUserId: payload.discordUserId } : null;
  } catch {
    return null;
  }
}
