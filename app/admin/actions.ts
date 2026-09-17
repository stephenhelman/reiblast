'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOOLS_SESSION_COOKIE } from '@/lib/constants'

// Admin shares the normal tools session (see lib/requireAdmin.ts) — signing
// out here signs out of the whole tools session, same as any member.
export async function adminLogoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete(TOOLS_SESSION_COOKIE)
  redirect('/tools/session-expired')
}
