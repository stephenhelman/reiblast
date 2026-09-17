import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/requireMember";
import { prisma } from "@/lib/prisma";
import { openToolUse, finalizeToolUse } from "@/lib/engine/toolUse";
import { sonnetCostCents } from "@/lib/engine/vendorPricing";
import type { ScoreDetail } from "@/lib/toolUseDetail";

const ARV_SYSTEM_PROMPT = `You are a real estate deal analyzer for wholesale investors. You analyze a subject property and comparable sales and return a structured JSON object. You never fabricate data. You only analyze what is provided.

ADJUSTMENT TABLE
These adjustments have already been applied to each comp's adjusted_price before being sent to you. Use adjusted_price — not sale_price — in all ARV and as-is calculations.

PRICE SOURCE
Each comp includes a priceSource field:
- 'sale': actual recorded sale price — use normally
- 'history': sale price from deed history — use normally
- 'assessment': county tax assessed value — use as a rough proxy only, weight significantly lower than actual sale prices, flag in warnings if all comps are assessment-only
- 'none': no price data — exclude from calculations

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
}`;

// daysSinceSold is calculated client-side at request time using current Date.now()
// Never trust stored daysSinceSold values — always recalculate from saleDate before sending
export async function POST(req: NextRequest) {
  let member: Awaited<ReturnType<typeof requireMember>>;
  try {
    member = await requireMember(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = member.role === "admin";

  let body: { subject?: unknown; comps?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !body.comps) {
    return NextResponse.json(
      { error: "subject and comps are required" },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.comps) || body.comps.length < 1) {
    return NextResponse.json(
      { error: "Select at least 1 comp" },
      { status: 400 },
    );
  }

  // DORMANT METER: withMeter (lib/engine/withMeter.ts) is the launch-time gate
  // for this route — precheck before spend, chargeOnSuccess/recordFailure,
  // 402 on out-of-credits. It is built and tested but deliberately NOT wired
  // here; arv runs unconditionally for any authenticated member until that's
  // a deliberate go-live decision. This route still opens/finalizes its own
  // ToolUse + ApiCall rows directly (observe now, charge later) — see the
  // 2026-09-16 admin data-layer appendix.
  const { id: toolUseId } = await openToolUse(prisma, {
    userId: member.userId,
    locationId: member.locationId,
    isAdmin,
    featureSlug: "score",
    kind: "SFR",
  });

  try {
    const start = Date.now();
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        output_config: { effort: "low" },
        system: ARV_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              subject: body.subject,
              comps: body.comps,
            }),
          },
        ],
      }),
    });

    const durationMs = Date.now() - start;

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error("[analyzer/arv] Claude API error:", err);
      await prisma.apiCall
        .create({
          data: {
            locationId: member.locationId,
            resource: "claude",
            endpoint: "/api/analyzer/arv",
            statusCode: claudeRes.status,
            durationMs,
            tool: "score",
            featureSlug: "score",
            model: "claude-sonnet-5",
            isAdmin,
            toolUseId,
          },
        })
        .catch(() => {});
      await finalizeToolUse(prisma, toolUseId, { outcome: "fail" }).catch(() => {});
      return NextResponse.json(
        { error: "Analysis service unavailable" },
        { status: 500 },
      );
    }

    const claudeData = await claudeRes.json();
    const inputTokens: number = claudeData.usage?.input_tokens ?? 0;
    const outputTokens: number = claudeData.usage?.output_tokens ?? 0;
    const costCents = sonnetCostCents(inputTokens, outputTokens);

    await prisma.apiCall
      .create({
        data: {
          locationId: member.locationId,
          resource: "claude",
          endpoint: "/api/analyzer/arv",
          statusCode: claudeRes.status,
          durationMs,
          tool: "score",
          featureSlug: "score",
          model: "claude-sonnet-5",
          inputTokens,
          outputTokens,
          costCents,
          isAdmin,
          toolUseId,
        },
      })
      .catch(() => {});

    const textBlock = (claudeData.content ?? []).find(
      (block: { type?: string }) => block.type === "text",
    );
    let text = textBlock?.text || "";
    text = text
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    let analysis;
    try {
      analysis = JSON.parse(text);
      const required = [
        "comps",
        "arv",
        "as_is",
        "exit_strategy",
        "narrative",
        "warnings",
      ];
      for (const key of required) {
        if (!(key in analysis))
          throw new Error(`Missing field in analysis: ${key}`);
      }
    } catch (parseErr) {
      console.error("[analyzer/arv] analysis parse/shape error:", parseErr);
      await finalizeToolUse(prisma, toolUseId, { outcome: "fail" }).catch(() => {});
      return NextResponse.json(
        { error: "Failed to generate analysis" },
        { status: 500 },
      );
    }

    const toolUseDetail: ScoreDetail = {
      featureSlug: "score",
      warnings: Array.isArray(analysis.warnings) ? analysis.warnings : [],
      exitStrategyRecommendation: analysis.exit_strategy?.recommendation ?? "",
      confidence: analysis.arv?.confidence ?? "low",
      compCount: Array.isArray(body.comps) ? body.comps.length : 0,
    };

    await finalizeToolUse(prisma, toolUseId, {
      outcome: "success",
      detail: toolUseDetail,
    }).catch(() => {});

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("[analyzer/arv] error:", err);
    await finalizeToolUse(prisma, toolUseId, { outcome: "fail" }).catch(() => {});
    return NextResponse.json(
      { error: "Failed to generate analysis" },
      { status: 500 },
    );
  }
}
