import { NextRequest } from "next/server";

/**
 * Validates the x-reiblast-secret header against GHL_WEBHOOK_SECRET.
 * Never logs the secret value.
 */
export function verifyWebhook(req: NextRequest): boolean {
  const incomingSecret = req.headers.get("x-reiblast-secret");
  return !!incomingSecret && incomingSecret === process.env.GHL_WEBHOOK_SECRET;
}
