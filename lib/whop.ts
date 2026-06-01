import crypto from "crypto";

export function verifyWhopWebhook(
  payload: string,
  signature: string,
  webhookId: string,
  webhookTimestamp: string,
): boolean {
  const secret = process.env.WHOP_WEBHOOK_SECRET!;

  // Signed content: msgId.timestamp.body
  const signedContent = `${webhookId}.${webhookTimestamp}.${payload}`;

  // Whop signs with raw secret as utf8
  const hmac = crypto
    .createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(signedContent)
    .digest("base64");

  // Strip v1, prefix, handle space-separated sigs
  const sigValue = signature.startsWith("v1,") ? signature.slice(3) : signature;

  return sigValue.split(" ").some((sig) => sig === hmac);
}

export function extractWhopEvent(body: Record<string, unknown>): {
  event: string;
  email: string;
  name: string;
  whopMemberId: string;
  planId: string;
  productId: string;
  userId: string;
} {
  const data = body.data as Record<string, unknown> | undefined;
  const user = data?.user as Record<string, unknown> | undefined;
  const plan = data?.plan as Record<string, unknown> | undefined;
  const product = data?.product as Record<string, unknown> | undefined;

  return {
    event: (body.type as string) || "",
    email: (user?.email as string) || "",
    name: (user?.name as string) || (user?.username as string) || "",
    whopMemberId: (data?.id as string) || "",
    planId: (plan?.id as string) || "",
    productId: (product?.id as string) || "",
    userId: (user?.id as string) || "",
  };
}
