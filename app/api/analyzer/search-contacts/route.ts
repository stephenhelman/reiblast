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
  if (!locationId || !address) {
    return NextResponse.json({ contacts: [] })
  }

  const streetPortion = address.split(',')[0].trim()
  console.log('[search-contacts] Contact search for street:', streetPortion)

  try {
    const accessToken = await getGhlAccessToken(locationId)

    const res = await fetch(`${GHL_BASE}/contacts/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[search-contacts] Contact search error:', errText)
      return NextResponse.json({ contacts: [], error: errText })
    }

    const data = await res.json()
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

    console.log('[search-contacts] Contact search returned', contacts.length, 'contacts')
    return NextResponse.json({ contacts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[search-contacts] Contact search error:', msg)
    return NextResponse.json({ contacts: [], error: msg })
  }
}
