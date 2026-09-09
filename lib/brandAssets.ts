// Single source of truth for brand asset paths under /public/brand. Components
// must import paths from here — never string-literal a /brand/... path inline.
// Actual PNG/SVG files are dropped into public/brand/{wordmarks,icons}/ separately;
// this file just maps slugs to where they'll live.

import type { ToolSlug } from "@/types/catalog";

export interface BrandAssets {
  wordmark: string;
  iconSvg: string;
  iconPng: string;
}

/** Portal-level brand (the "REI/tools" umbrella mark, not a catalog tool). */
export const portalBrand: BrandAssets = {
  wordmark: "/brand/wordmarks/rei-tools.png",
  iconSvg: "/brand/icons/rei-tools-icon.svg",
  iconPng: "/brand/icons/rei-tools-icon.png",
};

export const brandAssets: Record<ToolSlug, BrandAssets> = {
  "rei-score": {
    wordmark: "/brand/wordmarks/rei-score.png",
    iconSvg: "/brand/icons/rei-score-icon.svg",
    iconPng: "/brand/icons/rei-score-icon.png",
  },
  "rei-pack": {
    wordmark: "/brand/wordmarks/rei-pack.png",
    iconSvg: "/brand/icons/rei-pack-icon.svg",
    iconPng: "/brand/icons/rei-pack-icon.png",
  },
  "rei-ask": {
    wordmark: "/brand/wordmarks/rei-ask.png",
    iconSvg: "/brand/icons/rei-ask-icon.svg",
    iconPng: "/brand/icons/rei-ask-icon.png",
  },
  "rei-scrub": {
    wordmark: "/brand/wordmarks/rei-scrub.png",
    iconSvg: "/brand/icons/rei-scrub-icon.svg",
    iconPng: "/brand/icons/rei-scrub-icon.png",
  },
  "rei-dispo": {
    wordmark: "/brand/wordmarks/rei-dispo.png",
    iconSvg: "/brand/icons/rei-dispo-icon.svg",
    iconPng: "/brand/icons/rei-dispo-icon.png",
  },
  "rei-acq": {
    wordmark: "/brand/wordmarks/rei-acq.png",
    iconSvg: "/brand/icons/rei-acq-icon.svg",
    iconPng: "/brand/icons/rei-acq-icon.png",
  },
  "rei-close": {
    wordmark: "/brand/wordmarks/rei-close.png",
    iconSvg: "/brand/icons/rei-close-icon.svg",
    iconPng: "/brand/icons/rei-close-icon.png",
  },
  "rei-site": {
    wordmark: "/brand/wordmarks/rei-site.png",
    iconSvg: "/brand/icons/rei-site-icon.svg",
    iconPng: "/brand/icons/rei-site-icon.png",
  },
  "rei-kit": {
    wordmark: "/brand/wordmarks/rei-kit.png",
    iconSvg: "/brand/icons/rei-kit-icon.svg",
    iconPng: "/brand/icons/rei-kit-icon.png",
  },
};

export function getBrandAssets(slug: ToolSlug): BrandAssets {
  return brandAssets[slug];
}
