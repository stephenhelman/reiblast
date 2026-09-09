import { getBundle, getMember, getSoloPlans, getTools } from '@/lib/catalog'
import ToolsLauncherClient from '@/components/tools/ToolsLauncherClient'

export const dynamic = 'force-dynamic'

export default async function ToolsHomePage() {
  const member = await getMember()
  const tools = getTools()
  const soloPlans = getSoloPlans()
  const bundle = member.entitlements.bundleSlug ? getBundle(member.entitlements.bundleSlug) ?? null : null

  return <ToolsLauncherClient member={member} tools={tools} bundle={bundle} soloPlans={soloPlans} />
}
