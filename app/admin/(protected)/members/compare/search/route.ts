import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, RequireAdminError } from '@/lib/requireAdmin'
import { searchComparableMembers } from '@/lib/adminCompare'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(prisma, req)
  } catch (err) {
    if (err instanceof RequireAdminError) return NextResponse.json({ error: 'Not an admin' }, { status: 403 })
    throw err
  }

  const q = req.nextUrl.searchParams.get('q') ?? ''
  const results = await searchComparableMembers(q, prisma)
  return NextResponse.json({ results })
}
