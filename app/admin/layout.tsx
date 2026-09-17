import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'REIblast Admin',
  description: 'Operator dashboard — usage, vendor cost, and member lookup.',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
