import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { status: true, name: true, onboardingComplete: true },
  })

  if (!user) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({
    status: user.status,
    name: user.name,
    onboardingComplete: user.onboardingComplete,
  })
}
