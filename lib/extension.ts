// Companion Chrome extension ("REIscrub Puller"). Bump EXTENSION_VERSION by hand on each
// release so it matches the "version" in the zip's manifest.json.
export const EXTENSION_VERSION = '0.1.0'
export const EXTENSION_ZIP_PATH = '/downloads/reiscrub-puller.zip'

export const EXTENSION_BROWSERS = ['chrome', 'edge', 'brave'] as const
export type ExtensionBrowser = (typeof EXTENSION_BROWSERS)[number]

export const EXTENSION_BROWSER_LABEL: Record<ExtensionBrowser, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  brave: 'Brave',
}

export function extensionsUrl(browser: ExtensionBrowser): string {
  return `${browser}://extensions`
}
