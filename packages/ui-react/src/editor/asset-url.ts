import { defaultUrlTransform } from "react-markdown";
import { isAssetPath } from "@vellym-internal/core";

/** Allow asset: only for image src; keep the default URL safety policy elsewhere. */
export function assetUrlTransform(url: string, key: string): string {
  if (key === "src" && url.startsWith("asset:")) {
    const relativePath = url.slice(6);
    return isAssetPath(relativePath)
      ? `/api/v1/assets?path=${encodeURIComponent(relativePath)}` : "";
  }
  return defaultUrlTransform(url);
}
