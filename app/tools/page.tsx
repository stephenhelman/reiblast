import { getLauncherData } from '@/lib/launcherCatalog'
import { getOpenChangesForMember, type ReviewItem } from '@/lib/reviewFeed'
import { resolveSessionUserId } from '@/lib/toolsSession'
import { prisma } from '@/lib/prisma'
import ToolsLauncherClient from '@/components/tools/ToolsLauncherClient'

export const dynamic = 'force-dynamic'

export default async function ToolsHomePage() {
  const [{ member, tools }, userId] = await Promise.all([getLauncherData(), resolveSessionUserId(prisma)]);
  const openChanges: ReviewItem[] = userId ? await getOpenChangesForMember(prisma, userId) : [];

  return <ToolsLauncherClient member={member} tools={tools} openChanges={openChanges} />
}
