// Embed images, hosted in the GHL media library. Fill in the https URLs; a placeholder, empty or non-https value just omits the
// image from that embed (the post still goes out).
export type DiscordAssetKey =
  | "offerPrelaunch"
  | "offerClaimsOpen"
  | "whatsInside"
  | "reisite"
  | "googleYou"
  | "launch";

export const DISCORD_ASSETS: Record<DiscordAssetKey, string> = {
  offerPrelaunch:
    "https://assets.cdn.filesafe.space/KU2rSHDxTfZjZV1CxBkY/media/6add6e28c9d5b7168d68909d.png",
  offerClaimsOpen:
    "https://assets.cdn.filesafe.space/KU2rSHDxTfZjZV1CxBkY/media/6add6e26736386d0dcb50635.png",
  whatsInside:
    "https://assets.cdn.filesafe.space/KU2rSHDxTfZjZV1CxBkY/media/6add6e22d542268bb412b258.png",
  reisite:
    "https://assets.cdn.filesafe.space/KU2rSHDxTfZjZV1CxBkY/media/6add6e2a9c1511d5b9afd69c.png",
  googleYou:
    "https://assets.cdn.filesafe.space/KU2rSHDxTfZjZV1CxBkY/media/6add6e20d542268bb412b218.png",
  launch:
    "https://assets.cdn.filesafe.space/KU2rSHDxTfZjZV1CxBkY/media/6add6e249c1511d5b9afd643.png",
};

export function assetUrl(
  key: DiscordAssetKey,
  assets: Record<DiscordAssetKey, string> = DISCORD_ASSETS,
): string | null {
  const v = assets[key]?.trim();
  return v && /^https:\/\//i.test(v) ? v : null;
}
