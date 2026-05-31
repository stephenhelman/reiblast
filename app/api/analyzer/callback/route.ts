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

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')

  console.log('[analyzer/callback] OAuth callback received. code:', code ? `${code.slice(0, 8)}…` : 'missing')

  if (!code) {
    return htmlResponse(
      '<p>Connection failed. Please try again or contact support.</p>',
      400,
    )
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
      return htmlResponse(
        '<p>Connection failed. Please try again or contact support.</p>',
        500,
      )
    }

    const data = await tokenRes.json()
    const { access_token, refresh_token, expires_in, locationId } = data

    if (!access_token || !refresh_token || !locationId) {
      console.error('[analyzer/callback] OAuth callback error — missing fields in token response:', JSON.stringify(data))
      return htmlResponse(
        '<p>Connection failed. Please try again or contact support.</p>',
        500,
      )
    }

    const expiresAt = new Date(Date.now() + (expires_in ?? 86400) * 1000)

    await prisma.ghlToken.upsert({
      where: { locationId },
      create: { locationId, accessToken: access_token, refreshToken: refresh_token, expiresAt },
      update: { accessToken: access_token, refreshToken: refresh_token, expiresAt },
    })

    console.log('[analyzer/callback] Token stored for locationId:', locationId)

    return htmlResponse(`
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
    `)
  } catch (err) {
    console.error('[analyzer/callback] OAuth callback error:', err)
    return htmlResponse(
      '<p>Connection failed. Please try again or contact support.</p>',
      500,
    )
  }
}
