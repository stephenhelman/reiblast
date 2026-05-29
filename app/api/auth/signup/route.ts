import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createCheckoutSession } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json()

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Name, email, and password are required.' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) {
      return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        plan: 'core',
        status: 'pending',
      },
    })

    const checkoutUrl = await createCheckoutSession(email.toLowerCase())

    return NextResponse.json({ success: true, checkoutUrl })
  } catch (err) {
    console.error('[signup]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
