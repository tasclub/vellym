import type { DesignFont } from "../model/types.js";

/** Assets are local project data, never remote font services. */
export function designAssetUrl(path: string): string | undefined {
  if (!path || /^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(path) || path.includes("\\") ||
      path.split("/").some(part => part === "..")) return undefined;
  return `/api/v1/assets?path=${encodeURIComponent(path)}`;
}

/** One entry may point directly at a saved WOFF2/WOFF/TTF/OTF file. */
export function fontFaceCss(fonts: readonly DesignFont[], assetUrl = designAssetUrl): string {
  return fonts.flatMap(font => {
    const url = assetUrl(font.path);
    if (!url) return [];
    return font.weights.map(weight => `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(url)});font-weight:${/^\d+(?: \d+)?$/.test(String(weight)) ? weight : "normal"};font-display:swap;}`);
  }).join("\n");
}
