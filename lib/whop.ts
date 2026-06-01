import crypto from 'crypto'

export function verifyWhopWebhook(payload: string, signature: string): boolean {
  const secret = process.env.WHOP_WEBHOOK_SECRET!
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return hmac === signature
}

export function extractWhopEvent(body: Record<string, unknown>): {
  event: string
  email: string
  name: string
  whopMemberId: string
  planId: string
  userId: string
} {
  const data = body.data as Record<string, unknown> | undefined
  const user = data?.user as Record<string, unknown> | undefined
  return {
    event: (body.action as string) || '',
    email: (user?.email as string) || '',
    name: (user?.name as string) || (user?.username as string) || '',
    whopMemberId: (data?.id as string) || '',
    planId: (data?.plan_id as string) || '',
    userId: (user?.id as string) || '',
  }
}
