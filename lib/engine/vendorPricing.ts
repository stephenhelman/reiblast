// Anthropic per-token rates, in cents per token — used to turn real
// input/output token counts (captured on ApiCall) into vendorCostCents for
// the LedgerEntry/expense views. Only Sonnet is live (arv/route.ts,
// land/route.ts both call claude-sonnet-5); Haiku has no call site yet, so
// no Haiku rate is defined until the bots chat adds one.
//
// $2/$10 per 1M (input/output), Anthropic claude-sonnet-5, confirmed Sep
// 2026; re-verify — this rate moved once in 2026.
//
// NOT IMPLEMENTED: cached input is $0.20/1M. arv/route.ts and land/route.ts
// don't use prompt caching today, so every input token bills at the flat
// rate below. If either adopts caching later, a flat input rate will
// overstate cost on cache hits — split the rate then.
const SONNET_INPUT_CENTS_PER_TOKEN = 0.02 // $2 / 1M input tokens
const SONNET_OUTPUT_CENTS_PER_TOKEN = 0.1 // $10 / 1M output tokens

export function sonnetCostCents(inputTokens: number, outputTokens: number): number {
  return Math.round(
    inputTokens * SONNET_INPUT_CENTS_PER_TOKEN + outputTokens * SONNET_OUTPUT_CENTS_PER_TOKEN,
  )
}
