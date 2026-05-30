import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'REIblast Tools',
  description: 'Your wholesale operating system — member tools portal.',
}

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
