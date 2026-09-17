'use server'

import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { signAdminSession, ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE_SECONDS } from '@/lib/adminSession'

export type AdminLoginState = { error?: string }

export async function adminLoginAction(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')

  if (!email || !password) {
    return { error: 'Email and password required.' }
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || user.role !== 'admin' || !user.passwordHash) {
    return { error: 'Invalid credentials.' }
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return { error: 'Invalid credentials.' }
  }

  const token = await signAdminSession({ userId: user.id })
  const cookieStore = await cookies()
  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    path: '/',
  })

  redirect('/admin')
}
