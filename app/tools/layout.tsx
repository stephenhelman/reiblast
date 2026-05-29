import type { Metadata } from 'next'
import ToolsNav from '@/components/tools/ToolsNav'

export const metadata: Metadata = {
  title: 'REIblast Tools',
  description: 'Your wholesale operating system — member tools portal.',
}

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ToolsNav />
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </>
  )
}
