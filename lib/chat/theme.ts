/**
 * Widget theming helpers — all brand-token driven, zero hardcoded brand values.
 * Derives `--cw-on-primary` from the client's primary color and provides a
 * non-blocking WCAG contrast check.
 */

/** Normalize a hex string ("#abc", "abc", "#aabbcc") → 6-digit lowercase, or null. */
export function normalizeHex(hex: string | undefined | null): string | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return h.toLowerCase();
}

function relLuminance(hex: string): number | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** RGB channels normalized to 0–1, or null if unparseable. */
function rgb01(hex: string): [number, number, number] | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/**
 * Perceptual-ish proximity of two colors, 0 (identical) → 1 (opposite), via
 * normalized RGB Euclidean distance. Used to flag a primary≈accent collision.
 */
export function colorDistance(a: string, b: string): number | null {
  const ca = rgb01(a);
  const cb = rgb01(b);
  if (!ca || !cb) return null;
  const d = Math.sqrt(ca.reduce((s, v, i) => s + (v - cb[i]) ** 2, 0));
  return d / Math.sqrt(3);
}

/** WCAG contrast ratio between two hex colors (1–21), or null if unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';
const INK = '#1a1a1a';

/** Readable foreground for a given background: white or dark ink, whichever contrasts more. */
export function onColor(bgHex: string): string {
  const white = contrastRatio(WHITE, bgHex);
  const dark = contrastRatio(INK, bgHex);
  if (white === null || dark === null) return WHITE;
  return white >= dark ? WHITE : INK;
}

const AA_NORMAL = 4.5;

/**
 * Dev-visible, NON-BLOCKING contrast check. Because brand tokens vary per
 * client, a low-contrast brand could ship an unreadable widget — warn (never
 * throw, never block render) so it's caught before launch.
 */
// Below this normalized distance, primary and accent read as "near-identical".
const PROXIMITY = 0.12;

export function warnLowContrast(
  brandName: string,
  colors: { primary: string; accent: string; text: string; surface: string; onPrimary: string }
): void {
  if (typeof console === 'undefined') return;
  const pairs: Array<[string, string, string]> = [
    ['on-primary vs primary', colors.onPrimary, colors.primary],
    ['text vs surface', colors.text, colors.surface],
  ];
  for (const [label, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    if (ratio !== null && ratio < AA_NORMAL) {
      console.warn(
        `[chat] Low contrast for "${brandName}": ${label} = ${ratio.toFixed(2)}:1 ` +
          `(WCAG AA needs ≥ ${AA_NORMAL}:1). The widget still renders; consider adjusting the brand tokens.`
      );
    }
  }

  // The launcher fills with accent; if accent ≈ primary it may blend into a
  // primary-colored page section. The widget can't see the host page, but it
  // can flag this most-common collision.
  const dist = colorDistance(colors.primary, colors.accent);
  if (dist !== null && dist < PROXIMITY) {
    console.warn(
      `[chat] "${brandName}": primary and accent are very similar (distance ${dist.toFixed(2)}). ` +
        'The launcher fills with accent and may blend into a primary-colored page section — ' +
        'consider a more distinct accent color.'
    );
  }
}
