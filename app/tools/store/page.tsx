import {
  getBundle,
  getBundles,
  getCoreBaseline,
  getMember,
  getMembership,
  getOpDirectServices,
  getPacks,
  getSoloPlans,
  getTools,
} from '@/lib/catalog'
import { parseStoreLink } from '@/lib/storeLink'
import StoreClient from '@/components/store/StoreClient'

export const dynamic = 'force-dynamic'

interface StorePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function StorePage({ searchParams }: StorePageProps) {
  const params = await searchParams
  const arrival = parseStoreLink(params)

  const member = await getMember()
  const tools = getTools()
  const packs = getPacks()
  const bundles = getBundles()
  const coreBaseline = getCoreBaseline()
  const soloPlans = getSoloPlans()
  const services = getOpDirectServices()
  const membership = getMembership()
  const currentBundle = member.entitlements.bundleSlug ? getBundle(member.entitlements.bundleSlug) ?? null : null

  return (
    <StoreClient
      member={member}
      tools={tools}
      packs={packs}
      bundles={bundles}
      coreBaseline={coreBaseline}
      soloPlans={soloPlans}
      services={services}
      membership={membership}
      currentBundle={currentBundle}
      arrival={arrival}
    />
  )
}
