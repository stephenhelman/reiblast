// Typed long-tail detail for ToolUse.detail (Json?), discriminated on featureSlug.
// The promoted, queried-by-analytics facts (compSource, hitTokenMax, turnCount, ...)
// already live as real ToolUse columns (prisma/schema.prisma) — this union is ONLY
// for the per-tool detail that isn't worth a migration for. See the 2026-09-16
// admin data-layer appendix in .claude/docs/REItools-Architecture.md.
//
// Only 'score' is populated by live code as of this chat (arv/route.ts,
// land/route.ts). The other variants are typed now so ToolUse.detail has one
// shape across every tool, but nothing writes them yet — no bots/ask/scrub/pack
// route exists to hang real fields on until those chats land.

export type ScoreDetail = {
  featureSlug: 'score'
  warnings: string[]
  exitStrategyRecommendation: string
  confidence: 'high' | 'medium' | 'low'
  compCount: number
}

export type AskDetail = {
  featureSlug: 'ask'
}

export type BotsDetail = {
  featureSlug: 'bots'
}

export type ScrubDetail = {
  featureSlug: 'scrub'
}

export type PackDetail = {
  featureSlug: 'pack'
}

export type ToolUseDetail = ScoreDetail | AskDetail | BotsDetail | ScrubDetail | PackDetail

export function isScoreDetail(detail: unknown): detail is ScoreDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    (detail as { featureSlug?: unknown }).featureSlug === 'score'
  )
}
