import { redirect } from 'next/navigation'

export default function ToolsHomePage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  const token = searchParams.token
  redirect(token ? `/analyzer?token=${token}` : '/analyzer')
}
