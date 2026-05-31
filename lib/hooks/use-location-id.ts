'use client'

import { useSearchParams } from 'next/navigation'

/**
 * Returns the GHL locationId passed as the `token` query param.
 * Every tool page and nav component should use this instead of
 * calling useSearchParams().get('token') directly.
 *
 * Must be used inside a <Suspense> boundary.
 */
export function useLocationId(): string {
  return useSearchParams().get('token') ?? ''
}

/**
 * Builds a tool URL with the locationId preserved as the `token` param.
 * Use this for all cross-tool navigation (router.push, Link href, etc.)
 */
export function toolUrl(path: string, locationId: string): string {
  if (!locationId) return path
  return `${path}?token=${encodeURIComponent(locationId)}`
}
