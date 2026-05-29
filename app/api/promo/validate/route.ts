import { NextRequest, NextResponse } from 'next/server'
import { validatePromoCode } from '@/lib/promo'

// Rate limit: simple in-memory store (resets on cold start)
const attempts = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const record = attempts.get(ip)

  if (!record || now > record.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }

  if (record.count >= 10) return true
  record.count++
  return false
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { code } = await req.json()

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ valid: false })
  }

  const result = await validatePromoCode(code.trim().toUpperCase())

  if (!result) {
    return NextResponse.json({ valid: false })
  }

  return NextResponse.json(result)
}
