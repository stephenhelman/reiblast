import { NextRequest, NextResponse } from 'next/server'
import { getGhlAccessToken } from '@/lib/ghl-token'

const GHL_BASE = 'https://services.leadconnectorhq.com'

function capitalize(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function POST(req: NextRequest) {
  let body: { locationId?: string; address?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ contacts: [] })
  }

  const { locationId, address } = body
  console.log('[search-contacts] locationId:', locationId, '| address:', address)

  if (!locationId || !address) {
    console.warn('[search-contacts] Missing locationId or address — returning early')
    return NextResponse.json({ contacts: [] })
  }

  const streetPortion = address.split(',')[0].trim()
  console.log('[search-contacts] Street portion:', streetPortion)

  try {
    console.log('[search-contacts] Fetching access token for locationId:', locationId)
    const accessToken = await getGhlAccessToken(locationId)
    console.log('[search-contacts] Access token acquired, calling GHL contacts/search')

    const requestBody = {
      locationId,
      page: 1,
      pageLimit: 10,
      filters: [
        {
          field: 'address',
          operator: 'contains',
          value: streetPortion,
        },
      ],
    }
    console.log('[search-contacts] Request body:', JSON.stringify(requestBody))

    const res = await fetch(`${GHL_BASE}/contacts/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    console.log('[search-contacts] GHL response status:', res.status)

    if (!res.ok) {
      const errText = await res.text()
      console.error('[search-contacts] GHL error response:', errText)
      return NextResponse.json({ contacts: [], error: errText })
    }

    const data = await res.json()
    console.log('[search-contacts] Raw GHL response keys:', Object.keys(data))
    console.log('[search-contacts] Raw contacts count:', data.contacts?.length ?? 'contacts key missing')

    const raw: Array<{
      id?: string
      firstNameLowerCase?: string
      lastNameLowerCase?: string
      phone?: string
      address?: string
    }> = data.contacts ?? []

    const contacts = raw
      .filter((c) => c.id != null)
      .map((c) => ({
        id: c.id!,
        name: capitalize(((c.firstNameLowerCase ?? '') + ' ' + (c.lastNameLowerCase ?? '')).trim()),
        phone: c.phone ?? null,
        address: c.address ?? null,
      }))

    console.log('[search-contacts] Mapped contacts count:', contacts.length)
    return NextResponse.json({ contacts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[search-contacts] Caught error:', msg)
    return NextResponse.json({ contacts: [], error: msg })
  }
}
