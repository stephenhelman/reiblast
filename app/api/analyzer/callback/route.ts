import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const REDIRECT_URI = 'https://tools.reiblast.app/api/analyzer/callback'

function htmlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/html' },
  })
}

const SUCCESS_HTML = `
  <!DOCTYPE html>
  <html>
    <head><title>REIblast Connected</title></head>
    <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0A0A0A;color:#fff;">
      <div style="text-align:center;">
        <p style="font-size:18px;font-weight:600;color:#F5C842;margin-bottom:8px;">✓ REIblast connected successfully.</p>
        <p style="color:rgba(255,255,255,0.5);font-size:14px;">You can close this window.</p>
      </div>
    </body>
  </html>
`
const ERROR_HTML = '<p>Connection failed. Please try again or contact support.</p>'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')

  console.log('[analyzer/callback] OAuth callback received. code:', code ? `${code.slice(0, 8)}…` : 'missing')

  if (!code) {
    return htmlResponse(ERROR_HTML, 400)
  }

  try {
    const tokenRes = await fetch(`${GHL_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GHL_CLIENT_ID!,
        client_secret: process.env.GHL_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    })

    console.log('[analyzer/callback] Token exchange response status:', tokenRes.status)

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('[analyzer/callback] OAuth callback error — token exchange failed:', errText)
      return htmlResponse(ERROR_HTML, 500)
    }

    const data = await tokenRes.json()
    const { access_token, refresh_token, expires_in, companyId } = data

    if (!access_token || !refresh_token) {
      console.error('[analyzer/callback] OAuth callback error — missing tokens in response:', JSON.stringify(data))
      return htmlResponse(ERROR_HTML, 500)
    }

    const expiresAt = new Date(Date.now() + (expires_in ?? 86400) * 1000)

    console.log('[analyzer/callback] Company-level install detected for companyId', companyId)

    // ── Fetch all locations under this company ────────────────────────────────

    console.log('[analyzer/callback] Fetching locations for company', companyId)

    let locationsStored = 0

    try {
      const locRes = await fetch(
        `${GHL_BASE}/locations/search?companyId=${companyId}`,
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            Version: '2021-07-28',
          },
        }
      )

      if (!locRes.ok) {
        throw new Error(`Locations search failed (${locRes.status}): ${await locRes.text()}`)
      }

      const locData = await locRes.json()
      const locations: Array<{ id: string }> = locData.locations ?? locData ?? []

      console.log('[analyzer/callback] Found', locations.length, 'locations')

      for (const loc of locations) {
        await prisma.ghlToken.upsert({
          where: { locationId: loc.id },
          create: { locationId: loc.id, accessToken: access_token, refreshToken: refresh_token, expiresAt },
          update: { accessToken: access_token, refreshToken: refresh_token, expiresAt },
        })
        console.log('[analyzer/callback] Stored token for locationId', loc.id)
        locationsStored++
      }

      console.log('[analyzer/callback] All location tokens stored successfully')
    } catch (locErr) {
      console.warn('[analyzer/callback] Could not fetch locations — storing by companyId as fallback:', locErr)
      await prisma.ghlToken.upsert({
        where: { locationId: companyId },
        create: { locationId: companyId, accessToken: access_token, refreshToken: refresh_token, expiresAt },
        update: { accessToken: access_token, refreshToken: refresh_token, expiresAt },
      })
      console.log('[analyzer/callback] Stored token for locationId (companyId fallback):', companyId)
    }

    return htmlResponse(SUCCESS_HTML)
  } catch (err) {
    console.error('[analyzer/callback] OAuth callback error:', err)
    return htmlResponse(ERROR_HTML, 500)
  }
}
