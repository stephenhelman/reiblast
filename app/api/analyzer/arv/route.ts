import { NextRequest, NextResponse } from 'next/server'

const ARV_SYSTEM_PROMPT = `You are a real estate deal analyzer for wholesale investors. You analyze a subject property and comparable sales and return a structured JSON object. You never fabricate data. You only analyze what is provided.

ADJUSTMENT TABLE
These adjustments have already been applied to each comp's adjusted_price before being sent to you. Use adjusted_price — not sale_price — in all ARV and as-is calculations.

COMP CLASSIFICATION
Classify each comp as RENOVATED or AS_IS.

RENOVATED indicators: staged listing, high $/sqft for area, retail financing, short DOM, recently updated kitchen/bath mentioned, clear fix-and-flip characteristics.

AS_IS indicators: cash sale, distressed language (sold as-is, investor special, needs work, estate sale), low $/sqft, long DOM, clearly below neighborhood standard.

When classification is ambiguous: default to RENOVATED and note uncertainty in type_reasoning.

ARV ESTIMATION
Use only RENOVATED comps (adjusted_price) to estimate ARV.
Weight by: proximity (closer = higher weight), recency (more recent = higher weight), similarity after adjustment (less total adjustment = higher weight).

Factor in the subject property condition:
- light: subject is livable, minor work only — ARV should reflect full retail value
- full: moderate renovation needed — ARV is achievable but buyer needs margin
- heavy: significant investment required — flag if ARV spread is thin

Return arv_estimate, arv_low, arv_high, arv_confidence (high/medium/low), arv_confidence_reason.

If fewer than 2 renovated comps: use all comps, apply confidence penalty, note in warnings.

AS-IS VALUE ESTIMATION
Use only AS_IS comps (adjusted_price) to estimate current as-is value.
If no AS_IS comps: return null values and note absence.
Return as_is_value, as_is_low, as_is_high, as_is_note.

EXIT STRATEGY
Based on ARV, as-is value, condition, and comp mix — recommend one of:
WHOLESALE, FIX_AND_FLIP, SUBJECT_TO, PASS
Provide 2-3 sentences of plain-language reasoning.

DEAL NARRATIVE
3-5 sentences for a beginner wholesaler. Plain language. Cover:
- What the comps say about this neighborhood
- Whether this is worth pursuing given the condition
- What to watch out for before making an offer

WARNINGS
Return array of warning strings for:
- Fewer than 3 comps total
- Fewer than 2 renovated comps
- ARV spread exceeds 15% of estimate
- As-is value within 10% of ARV (thin spread)
- All comps same type
- Any comp older than 9 months
- Any comp required more than $20,000 total adjustment

OUTPUT — return only valid JSON, no markdown, no preamble:

{
  "comps": [
    {
      "address": "string",
      "sale_price": number,
      "adjusted_price": number,
      "type": "RENOVATED" | "AS_IS",
      "type_reasoning": "string",
      "weight": "high" | "medium" | "low"
    }
  ],
  "arv": {
    "estimate": number,
    "low": number,
    "high": number,
    "confidence": "high" | "medium" | "low",
    "confidence_reason": "string"
  },
  "as_is": {
    "value": number | null,
    "low": number | null,
    "high": number | null,
    "note": "string"
  },
  "exit_strategy": {
    "recommendation": "WHOLESALE" | "FIX_AND_FLIP" | "SUBJECT_TO" | "PASS",
    "reasoning": "string"
  },
  "narrative": "string",
  "warnings": ["string"]
}`

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

  if (!Array.isArray(body.comps) || body.comps.length < 1) {
    return NextResponse.json({ error: 'Select at least 1 comp' }, { status: 400 })
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
        max_tokens: 1500,
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
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    const analysis = JSON.parse(text)

    const required = ['comps', 'arv', 'as_is', 'exit_strategy', 'narrative', 'warnings']
    for (const key of required) {
      if (!(key in analysis)) throw new Error(`Missing field in analysis: ${key}`)
    }

    return NextResponse.json(analysis)
  } catch (err) {
    console.error('[analyzer/arv] error:', err)
    return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 500 })
  }
}
