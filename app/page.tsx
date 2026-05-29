import { redirect } from 'next/navigation'

// Middleware handles routing; this fallback redirects to the marketing home.
export default function RootPage() {
  redirect('/marketing')
}
