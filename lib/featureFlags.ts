// TEMP launch gate — remove at tools launch, tools path becomes default.
// Single definition so the flag can never be checked with a truthy-string
// footgun (env vars are strings; "false" is truthy). Enabled ONLY on the
// literal string "true" — unset, "false", "", or anything else is OFF.
export const toolsOnboardingEnabled = () =>
  process.env.TOOLS_ONBOARDING_ENABLED === "true";
