import { NextRequest, NextResponse } from 'next/server'
import { getGhlAccessToken } from '@/lib/ghl-token'

const GHL_BASE = 'https://services.leadconnectorhq.com'

export async function POST(req: NextRequest) {
  let body: { locationId?: string; firstName?: string; lastName?: string; address1?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ contactId: null, error: 'Invalid JSON' })
  }

  const { locationId, firstName, lastName, address1 } = body
  if (!locationId || !firstName) {
    return NextResponse.json({ contactId: null, error: 'Missing required fields' })
  }

  console.log('[create-contact] Creating contact for locationId', locationId, '| name:', firstName, lastName)

  try {
    const accessToken = await getGhlAccessToken(locationId)

    const res = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ locationId, firstName, lastName, address1 }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[create-contact] GHL create failed:', res.status, errText)
      return NextResponse.json({ contactId: null, error: errText })
    }

    const data = await res.json()
    const contactId: string | null = data.contact?.id ?? null
    console.log('[create-contact] Contact created:', contactId)
    return NextResponse.json({ contactId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-contact] Error:', msg)
    return NextResponse.json({ contactId: null, error: msg })
  }
}
