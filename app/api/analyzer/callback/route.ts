import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const REDIRECT_URI = 'https://tools.reiblast.app/api/analyzer/callback'

function htmlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>REIblast Connected</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0f0f0f;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      text-align: center;
      padding: 48px 40px;
      border: 0.5px solid #2a2a2a;
      border-radius: 12px;
      max-width: 420px;
      width: 90%;
    }
    .icon {
      width: 56px;
      height: 56px;
      background: #DABD5920;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .checkmark {
      width: 24px;
      height: 24px;
      stroke: #DABD59;
      fill: none;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    h1 {
      font-size: 20px;
      font-weight: 500;
      color: #ffffff;
      margin-bottom: 10px;
    }
    p {
      font-size: 14px;
      color: #888;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .badge {
      display: inline-block;
      font-size: 12px;
      color: #DABD59;
      border: 0.5px solid #DABD5940;
      padding: 4px 14px;
      border-radius: 99px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg class="checkmark" viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h1>REIblast connected</h1>
    <p>Your account has been linked successfully.
    You can close this window and return to your dashboard.</p>
    <span class="badge">Deal Analyzer ready</span>
  </div>
</body>
</html>`

const ERROR_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Connection Failed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0f0f0f;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      text-align: center;
      padding: 48px 40px;
      border: 0.5px solid #2a2a2a;
      border-radius: 12px;
      max-width: 420px;
      width: 90%;
    }
    .icon {
      width: 56px;
      height: 56px;
      background: #ff444420;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .xmark {
      width: 24px;
      height: 24px;
      stroke: #ff4444;
      fill: none;
      stroke-width: 2.5;
      stroke-linecap: round;
    }
    h1 {
      font-size: 20px;
      font-weight: 500;
      color: #ffffff;
      margin-bottom: 10px;
    }
    p {
      font-size: 14px;
      color: #888;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .badge {
      display: inline-block;
      font-size: 12px;
      color: #ff4444;
      border: 0.5px solid #ff444440;
      padding: 4px 14px;
      border-radius: 99px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg class="xmark" viewBox="0 0 24 24">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </div>
    <h1>Connection failed</h1>
    <p>Something went wrong linking your account.
    Please try reinstalling the app or contact
    REIblast support.</p>
    <span class="badge">Error — see logs</span>
  </div>
</body>
</html>`

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
