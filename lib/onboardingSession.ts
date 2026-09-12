// Signed onboarding-identity cookie — same jose/JWT approach as lib/toolsSession.ts,
// but a SEPARATE cookie/secret. This one carries {contactId,name,email,phone} across
// the pre-a2p marketing funnel (onboarding -> /welcome -> /discovery); it grants no
// access and is unrelated to TOOLS_SESSION_COOKIE.
//
// No cookie-domain helper here (unlike toolsCookieDomain) — onboarding/welcome/
// discovery are all app/marketing/* on one host, so a host-only cookie (no
// `domain` attribute, path "/") is readable everywhere it needs to be. See the
// discovery Step 1 report for why a domain attribute would be a footgun here.

import { SignJWT, jwtVerify } from "jose";
import { ONBOARDING_COOKIE_MAX_AGE_SECONDS } from "@/lib/constants";

export interface OnboardingIdentity {
  contactId: string;
  name: string;
  email: string;
  phone: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.ONBOARDING_COOKIE_SECRET;
  if (!secret) {
    throw new Error("ONBOARDING_COOKIE_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function signOnboardingCookie(identity: OnboardingIdentity): Promise<string> {
  return new SignJWT({ ...identity })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ONBOARDING_COOKIE_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyOnboardingCookie(token: string): Promise<OnboardingIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (
      typeof payload.contactId !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.phone !== "string"
    ) {
      return null;
    }
    return { contactId: payload.contactId, name: payload.name, email: payload.email, phone: payload.phone };
  } catch {
    return null;
  }
}
