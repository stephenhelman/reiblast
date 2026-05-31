import { prisma } from '@/lib/prisma'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh when within 5 minutes of expiry

export async function getGhlAccessToken(locationId: string): Promise<string> {
  console.log('[ghl-token] Getting GHL token for locationId', locationId)

  const record = await prisma.ghlToken.findUnique({ where: { locationId } })

  if (!record) {
    throw new Error(
      'No GHL token found for this location. Please reinstall the REIblast app.'
    )
  }

  if (record.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    console.log('[ghl-token] Token valid, returning')
    return record.accessToken
  }

  console.log('[ghl-token] Token expiring soon, refreshing')

  try {
    const res = await fetch(`${GHL_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GHL_CLIENT_ID!,
        client_secret: process.env.GHL_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: record.refreshToken,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Token refresh request failed (${res.status}): ${errText}`)
    }

    const data = await res.json()
    const newAccessToken: string = data.access_token
    const newRefreshToken: string = data.refresh_token ?? record.refreshToken
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 86400) * 1000)

    await prisma.ghlToken.update({
      where: { locationId },
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresAt },
    })

    console.log('[ghl-token] Token refreshed successfully')
    return newAccessToken
  } catch (err) {
    console.error('[ghl-token] Token refresh failed:', err)
    throw err
  }
}
