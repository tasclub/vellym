import { defaultUrlTransform } from "react-markdown";
import { isAssetPath } from "@vellym-internal/core";
import { staticMediaBase } from "../shared/api.js";

/** Allow asset: only for image src; keep the default URL safety policy elsewhere. */
export function assetUrlTransform(url: string, key: string): string {
  if (key === "src" && url.startsWith("asset:")) {
    const relativePath = url.slice(6);
    if (!isAssetPath(relativePath)) return "";
    // The static site serves images it copied to media/; the dev server serves them via the API.
    const media = staticMediaBase();
    return media
      ? `${media}/${relativePath.split("/").map(encodeURIComponent).join("/")}`
      : `/api/v1/assets?path=${encodeURIComponent(relativePath)}`;
  }
  return defaultUrlTransform(url);
}
