import { NextResponse } from "next/server";

/**
 * Kill switch for the deal analyzer (SFR + land). Set ANALYZER_DISABLED=true
 * in the environment (Vercel env var, then redeploy) to turn it off; unset or
 * any other value leaves it on. Server-side only, read at request time.
 *
 * Enforced in two places: middleware swaps the /analyzer pages for a notice,
 * and every /api/analyzer/* handler calls analyzerDisabledResponse() first
 * (the API is excluded from the middleware matcher, and calls can be made
 * directly with a valid session, so the pages alone aren't enough).
 */
export function isAnalyzerDisabled(): boolean {
  return process.env.ANALYZER_DISABLED === "true";
}

export function analyzerDisabledResponse(): NextResponse | null {
  if (!isAnalyzerDisabled()) return null;
  return NextResponse.json(
    { error: "The Deal Analyzer is temporarily unavailable." },
    { status: 503 },
  );
}
