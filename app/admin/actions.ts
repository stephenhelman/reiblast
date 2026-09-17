'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ADMIN_SESSION_COOKIE } from '@/lib/adminSession'

export async function adminLogoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_SESSION_COOKIE)
  redirect('/admin/login')
}
