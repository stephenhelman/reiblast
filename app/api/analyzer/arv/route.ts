import { NextRequest, NextResponse } from 'next/server'

const ARV_SYSTEM_PROMPT = `You are a real estate wholesale deal analyzer.
You receive a subject property and comparable sales selected by the user. Analyze the comps and produce a deal analysis for a wholesale investor.

Respond with valid JSON only. No preamble, no markdown, no text outside the JSON.

Return exactly this structure:
{
  "arv": {
    "low": number,
    "high": number,
    "estimate": number,
    "pricePerSqft": number,
    "confidence": "high" | "medium" | "low",
    "confidenceReason": string
  },
  "repairs": {
    "light": { "low": number, "high": number, "description": string },
    "medium": { "low": number, "high": number, "description": string },
    "heavy": { "low": number, "high": number, "description": string }
  },
  "mao": { "light": number, "medium": number, "heavy": number },
  "dealScore": "strong" | "borderline" | "pass",
  "dealScoreReason": string,
  "narrative": string,
  "bestComp": string
}

MAO formula: (ARV * 0.70) - repairs - 5000
5000 = minimum assignment fee

Repair guidelines:
- Light: cosmetic only, paint, flooring, fixtures. 5-15 per sqft.
- Medium: kitchen update, bath refresh, flooring, paint, minor systems. 20-40 per sqft.
- Heavy: full gut, kitchen, baths, roof, HVAC, electrical, plumbing. 50-100 per sqft.

Adjust for property age, sqft, and state labor costs.

Deal score:
- strong: clear margin at medium rehab MAO
- borderline: works at light rehab only
- pass: MAO below any reasonable asking price`

export async function POST(req: NextRequest) {
  let body: { subject?: unknown; comps?: unknown[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.subject || !body.comps) {
    return NextResponse.json({ error: 'subject and comps are required' }, { status: 400 })
  }

  if (!Array.isArray(body.comps) || body.comps.length < 3 || body.comps.length > 6) {
    return NextResponse.json({ error: 'Select between 3 and 6 comps' }, { status: 400 })
  }

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: ARV_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ subject: body.subject, comps: body.comps }),
          },
        ],
      }),
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.text()
      console.error('[analyzer/arv] Claude API error:', err)
      return NextResponse.json({ error: 'Analysis service unavailable' }, { status: 500 })
    }

    const claudeData = await claudeRes.json()
    let text = claudeData.content?.[0]?.text || ''

    // Strip markdown fences if present
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    const analysis = JSON.parse(text)

    // Validate required top-level keys
    const required = ['arv', 'repairs', 'mao', 'dealScore', 'dealScoreReason', 'narrative', 'bestComp']
    for (const key of required) {
      if (!(key in analysis)) {
        throw new Error(`Missing field in analysis: ${key}`)
      }
    }

    return NextResponse.json(analysis)
  } catch (err) {
    console.error('[analyzer/arv] error:', err)
    return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 500 })
  }
}
