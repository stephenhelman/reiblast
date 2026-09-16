import { ChatConfig } from './types';

/**
 * Assistant identity — house style, in code. Honest by design: never a fake
 * human first name. Resolution order:
 *   1. assistantName (Sanity)          — verbatim
 *   2. "{ownerName}’s Assistant"        — warm + accountable, still honest
 *   3. "{brandName} Assistant"          — fallback
 */
export function resolveAssistantName(
  config: Pick<ChatConfig, 'assistantName' | 'ownerName' | 'brandName'>
): string {
  if (config.assistantName?.trim()) return config.assistantName.trim();
  if (config.ownerName?.trim()) return `${config.ownerName.trim()}’s Assistant`;
  return `${config.brandName} Assistant`;
}

/**
 * Monogram initials — keyed to the BUSINESS (brandName). `avatarInitials`
 * override wins; otherwise the first letter of the FIRST WORD only
 * ("NorthStar Overages" → "N", never the word "NO").
 */
export function resolveInitials(
  config: Pick<ChatConfig, 'avatarInitials' | 'brandName'>
): string {
  const override = config.avatarInitials?.trim();
  if (override) return override.slice(0, 2).toUpperCase();
  const firstWord = config.brandName.trim().split(/\s+/)[0] ?? '';
  return (firstWord.charAt(0) || '?').toUpperCase();
}
