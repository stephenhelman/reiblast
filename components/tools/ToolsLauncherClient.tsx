'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import AppHeader from '@/components/shared/AppHeader'
import Button from '@/components/shared/Button'
import ToolCard from '@/components/tools/ToolCard'
import ChoiceModal from '@/components/tools/ChoiceModal'
import { buildStoreLink } from '@/lib/storeLink'
import { portalBrand } from '@/lib/brandAssets'
import type { Bundle, Member, SoloPlan, Tool } from '@/types/catalog'

interface ToolsLauncherClientProps {
  member: Member
  tools: Tool[]
  bundle: Bundle | null
  soloPlans: SoloPlan[]
}

/** Presentational shell + interaction state (choice modal). Data is resolved server-side by app/tools/page.tsx via getMember(). */
export default function ToolsLauncherClient({ member, tools, bundle, soloPlans }: ToolsLauncherClientProps) {
  const [choiceTool, setChoiceTool] = useState<Tool | null>(null)
  const firstName = member.name.split(' ')[0]
  const totalCredits = Object.values(member.entitlements.creditBalances).reduce(
    (sum, balance) => sum + (balance ?? 0),
    0,
  )

  return (
    <main className="min-h-screen bg-black text-white">
      <AppHeader
        brandSlot={<Image src={portalBrand.wordmark} alt="REI/tools" height={30} width={140} style={{ height: 30, width: 'auto' }} />}
        account={{ name: member.name, creditBalance: totalCredits }}
        actionSlot={
          <Link href={buildStoreLink({ from: 'launcher', intent: 'credits' })}>
            <Button variant="gold" size="sm">
              Get credits
            </Button>
          </Link>
        }
      />

      <div className="max-w-310 w-full mx-auto px-6 md:px-12 lg:px-16 pt-10 pb-24">
        <div className="mb-6.5">
          <h1 className="text-2xl font-semibold">Welcome back, {firstName}</h1>
          <p className="text-gray text-sm mt-1.25">Pick a tool to get started.</p>
        </div>

        <div className="grid gap-4.5 grid-cols-[repeat(auto-fill,minmax(310px,1fr))]">
          {tools.map((tool, index) => (
            <div
              key={tool.slug}
              className={`animate-fade-rise ${index === 1 ? '[animation-delay:100ms]' : ''}`}
            >
              <ToolCard
                tool={tool}
                member={member}
                bundle={bundle}
                soloPlans={soloPlans}
                onKeepGoing={setChoiceTool}
              />
            </div>
          ))}
        </div>
      </div>

      {choiceTool && (
        <ChoiceModal open={!!choiceTool} onClose={() => setChoiceTool(null)} tool={choiceTool} />
      )}
    </main>
  )
}
