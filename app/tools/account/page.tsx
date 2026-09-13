import { getAccountData } from '@/lib/accountData'
import AccountClient from '@/components/account/AccountClient'

export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const account = await getAccountData()
  return <AccountClient account={account} />
}
