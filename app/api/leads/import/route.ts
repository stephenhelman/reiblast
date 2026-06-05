import { NextRequest, NextResponse } from 'next/server'
import { getGhlAccessToken } from '@/lib/ghl-token'
import type { CleanedContact, DealMachineContact } from '@/lib/leadCleaner'

const GHL_BASE = 'https://services.leadconnectorhq.com'

type AnyContact = CleanedContact | DealMachineContact

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { contacts, locationId, tag } = body as {
    contacts: AnyContact[]
    locationId: string
    tag: string
  }

  if (!locationId || !contacts || contacts.length === 0) {
    return NextResponse.json({ error: 'locationId and contacts are required' }, { status: 400 })
  }

  let token: string
  try {
    token = await getGhlAccessToken(locationId)
  } catch {
    return NextResponse.json({ error: 'No GHL token for this location' }, { status: 401 })
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  }

  let added = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  const BATCH_SIZE = 10
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map(async (contact) => {
        const cleaned = contact as CleanedContact
        const dm = contact as DealMachineContact

        const payload = {
          locationId,
          firstName: cleaned.firstName || '',
          lastName: cleaned.lastName || '',
          email: cleaned.email || '',
          phone: cleaned.phone || '',
          address1: cleaned.propertyAddress || dm.address || '',
          city: cleaned.city || dm.city || '',
          state: cleaned.state || dm.state || '',
          postalCode: cleaned.zip || dm.zip || '',
          tags: [tag],
        }

        const res = await fetch(`${GHL_BASE}/contacts/`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })

        if (res.status === 201) {
          return 'added'
        }

        const data = await res.json().catch(() => ({}))

        if (res.status === 400 && data?.meta?.contactId) {
          // Existing contact — optionally add the tag
          await fetch(`${GHL_BASE}/contacts/${data.meta.contactId}/tags`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ tags: [tag] }),
          }).catch(() => null)
          return 'skipped'
        }

        throw new Error(`GHL ${res.status}: ${JSON.stringify(data)}`)
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value === 'added') added++
        else skipped++
      } else {
        failed++
        errors.push(String(result.reason))
      }
    }

    if (i + BATCH_SIZE < contacts.length) {
      await sleep(100)
    }
  }

  return NextResponse.json({ added, skipped, failed, errors })
}
