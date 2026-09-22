import { getAccountData } from '@/lib/accountData'
import { getOpenChangesForMember, type ReviewItem } from '@/lib/reviewFeed'
import { resolveSessionUserId } from '@/lib/toolsSession'
import { prisma } from '@/lib/prisma'
import AccountClient from '@/components/account/AccountClient'

export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const [account, userId] = await Promise.all([getAccountData(), resolveSessionUserId(prisma)])
  const openChanges: ReviewItem[] = userId ? await getOpenChangesForMember(prisma, userId) : []
  return <AccountClient account={account} openChanges={openChanges} />
}
