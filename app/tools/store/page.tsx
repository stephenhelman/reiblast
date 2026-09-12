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

  return <StoreClient store={store} arrival={arrival} />
}
