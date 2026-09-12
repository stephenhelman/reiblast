import { cookies } from 'next/headers'
import { getDiscoveryCatalog } from '@/lib/discoveryCatalog'
import { verifyOnboardingCookie } from '@/lib/onboardingSession'
import { ONBOARDING_COOKIE } from '@/lib/constants'
import DiscoveryClient from '@/components/discovery/DiscoveryClient'

export const dynamic = 'force-dynamic'

interface DiscoveryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DiscoveryPage({ searchParams }: DiscoveryPageProps) {
  const params = await searchParams
  const emailParam = params.email
  const emailHint = typeof emailParam === 'string' ? emailParam : Array.isArray(emailParam) ? emailParam[0] ?? null : null

  const cookieStore = await cookies()
  const token = cookieStore.get(ONBOARDING_COOKIE)?.value
  const cookieIdentity = token ? await verifyOnboardingCookie(token) : null

  const catalog = await getDiscoveryCatalog()

  return (
    <DiscoveryClient
      catalog={catalog}
      cookieIdentity={cookieIdentity}
      emailHint={emailHint ?? null}
      showPreviewControls={process.env.NODE_ENV !== 'production'}
    />
  )
}
