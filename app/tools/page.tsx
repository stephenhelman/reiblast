import { getLauncherData } from '@/lib/launcherCatalog'
import ToolsLauncherClient from '@/components/tools/ToolsLauncherClient'

export const dynamic = 'force-dynamic'

export default async function ToolsHomePage() {
  const { member, tools } = await getLauncherData()

  return <ToolsLauncherClient member={member} tools={tools} />
}
