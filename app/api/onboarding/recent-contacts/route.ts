import { NextResponse } from 'next/server'

const GHL_BASE_URL = 'https://services.leadconnectorhq.com'

function hqHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  const masked = local.slice(0, 2) + '***'
  return `${masked}@${domain}`
}

function maskName(firstName: string, lastName: string): string {
  const last = lastName?.charAt(0) || ''
  return `${firstName} ${last}.`.trim()
}

export async function GET() {
  try {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000

    const res = await fetch(
      `${GHL_BASE_URL}/contacts/?locationId=${process.env.GHL_HQ_LOCATION_ID}&startAfter=${fifteenMinutesAgo}&limit=10`,
      { headers: hqHeaders() },
    )

    if (!res.ok) {
      console.error('[recent-contacts] GHL fetch failed:', res.status)
      return NextResponse.json({ contacts: [] })
    }

    const data = await res.json()
    const contacts = (data.contacts || []) as Array<{
      id: string
      firstName?: string
      lastName?: string
      email?: string
      tags?: string[]
      dateAdded?: string
    }>

    const filtered = contacts
      .filter((c) => {
        if (!c.email) return false
        const hasPaymentTag = c.tags?.includes('Payment Received') ?? false
        const createdAt = new Date(c.dateAdded || 0).getTime()
        return hasPaymentTag || createdAt >= fifteenMinutesAgo
      })
      .sort((a, b) => new Date(b.dateAdded || 0).getTime() - new Date(a.dateAdded || 0).getTime())
      .slice(0, 5)

    const result = filtered.map((c) => ({
      contactId: c.id,
      displayName: maskName(c.firstName || '', c.lastName || ''),
      maskedEmail: maskEmail(c.email!),
      createdAt: c.dateAdded || new Date().toISOString(),
    }))

    return NextResponse.json({ contacts: result })
  } catch (err) {
    console.error('[recent-contacts] error:', err)
    return NextResponse.json({ contacts: [] })
  }
}
