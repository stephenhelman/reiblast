import Image from "next/image";

// Exact PNG pixel dimensions — keeps Image from stretching/squishing
const ICON_ASPECT = 420 / 389;        // icon-mark.png: 420 × 389
const LOCKUP_ASPECT = 1538 / 439;     // full-lockup.png: 1538 × 439
const STACKED_ASPECT = 1070 / 689;    // logo-stacked.png: 1070 × 689

interface LogoProps {
  /** Target height in px. Width is derived from each asset's natural aspect ratio. */
  size?: number;
  /** Reserved for future light-bg variant. Currently unused — both variants use the same dark-bg assets. */
  variant?: "dark" | "light";
}

/** Square icon mark only. */
export function Logo({ size = 40 }: LogoProps) {
  return (
    <Image
      src="/icon-mark.png"
      alt="REIblast"
      height={size}
      width={Math.round(size * ICON_ASPECT)}
      priority
    />
  );
}

/** Horizontal full lockup: icon mark + wordmark side by side. */
export function LogoFull({ size = 40 }: LogoProps) {
  return (
    <Image
      src="/full-lockup.png"
      alt="REIblast"
      height={size}
      width={Math.round(size * LOCKUP_ASPECT)}
      priority
    />
  );
}

/** Stacked lockup: icon mark above wordmark. */
export function LogoStacked({ size = 80 }: LogoProps) {
  return (
    <Image
      src="/logo-stacked.png"
      alt="REIblast"
      height={size}
      width={Math.round(size * STACKED_ASPECT)}
      priority
    />
  );
}
