import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const users = await prisma.user.findMany({
    where: {
      status: 'pending_onboarding',
      createdAt: { lt: cutoff },
    },
    select: {
      email: true,
      name: true,
      createdAt: true,
      ghlContactId: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ count: users.length, users })
}
