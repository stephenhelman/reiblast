'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { verifyOtp, resendOtp } from '@/lib/otp'
import { signToolsSession, toolsCookieDomain } from '@/lib/toolsSession'
import {
  TOOLS_SESSION_COOKIE,
  TOOLS_SESSION_MAX_AGE_SECONDS,
  TOOLS_OTP_SEND_COOLDOWN_MS,
} from '@/lib/constants'

async function resolveActiveMember(locationId: string) {
  const user = await prisma.user.findFirst({ where: { ghlLocationId: locationId } })
  if (!user || user.status !== 'active' || !user.a2pPhone || !user.ghlContactId) {
    return null
  }
  return user
}

export type VerifyState = { error?: string; attemptsRemaining?: number }

export async function verifyOtpAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const locationId = String(formData.get('locationId') || '')
  const code = String(formData.get('code') || '')

  if (!locationId || !code) {
    return { error: 'Missing code.' }
  }

  const user = await resolveActiveMember(locationId)
  if (!user) {
    return { error: 'Access not available.' }
  }

  const result = await verifyOtp({
    userId: user.id,
    code,
  })

  if (result.status === 'expired') {
    return { error: 'Code expired. Request a new one.' }
  }
  if (result.status === 'locked_out') {
    return { error: 'Too many incorrect attempts. Request a new code.' }
  }
  if (result.status === 'wrong') {
    return { error: 'Incorrect code.', attemptsRemaining: result.attemptsRemaining }
  }

  const token = await signToolsSession({ userId: user.id, locationId })
  const requestHeaders = await headers()
  const host = requestHeaders.get('host') || ''
  const cookieDomain = toolsCookieDomain(host)
  // TEMP DIAGNOSTIC — remove once session persistence is confirmed working.
  console.log('[enter/verify] host:', host, 'cookieDomain:', cookieDomain, 'token length:', token.length)
  const cookieStore = await cookies()
  cookieStore.set(TOOLS_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    domain: cookieDomain,
    maxAge: TOOLS_SESSION_MAX_AGE_SECONDS,
    path: '/',
  })
  console.log('[enter/verify] cookie set, redirecting to /')

  redirect('/')
}

export type ResendState = { error?: string; cooldown?: boolean; sent?: boolean }

export async function resendOtpAction(_prev: ResendState, formData: FormData): Promise<ResendState> {
  const locationId = String(formData.get('locationId') || '')
  if (!locationId) {
    return { error: 'Missing location.' }
  }

  const user = await resolveActiveMember(locationId)
  if (!user) {
    return { error: 'Access not available.' }
  }

  if (user.otpLastSentAt && Date.now() - user.otpLastSentAt.getTime() < TOOLS_OTP_SEND_COOLDOWN_MS) {
    return { cooldown: true }
  }

  const result = await resendOtp({
    userId: user.id,
    contactId: user.ghlContactId as string,
    phone: user.a2pPhone as string,
    flow: 'tools',
  })

  if (!result.success) {
    return { error: 'Failed to send code. Please try again.' }
  }

  return { sent: true }
}
