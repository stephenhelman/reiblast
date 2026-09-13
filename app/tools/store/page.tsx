import { getStoreData } from '@/lib/storeCatalog'
import { parseStoreLink } from '@/lib/storeLink'
import StoreClient from '@/components/store/StoreClient'

export const dynamic = 'force-dynamic'

interface StorePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function StorePage({ searchParams }: StorePageProps) {
  const params = await searchParams
  const arrival = parseStoreLink(params)
  const store = await getStoreData()

  const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY
  if (!stripePublishableKey) throw new Error('StorePage: STRIPE_PUBLISHABLE_KEY is not set')

  return <StoreClient store={store} arrival={arrival} stripePublishableKey={stripePublishableKey} />
}
