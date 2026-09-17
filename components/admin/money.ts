import { formatCents } from '@/lib/money'

/** Cents formatter that degrades to an em dash for inapplicable metrics (e.g. revenue on a core-included feature with no paid tier) — never a bare $0 standing in for "no data". */
export function formatCentsOrDash(cents: number | null): string {
  if (cents === null) return '—'
  return formatCents(cents)
}

export function formatCountOrDash(n: number | null): string {
  if (n === null) return '—'
  return n.toLocaleString()
}
