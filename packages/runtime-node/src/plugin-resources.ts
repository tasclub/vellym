import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { STABLE_API_VERSION, validateResource } from "@vellym-internal/core";
import type { PluginResourceDraft } from "@vellym/plugin-api";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";

/** content root相対のフォルダとして安全か。外へ出る指定を受け付けない */
function safeFolder(value: string | undefined): string {
  const folder = (value ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!folder) return "";
  const parts = folder.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new RuntimeError("作成先が不正です", 400, "INVALID_FOLDER");
  }
  return parts.join("/");
}

/**
 * プラグインの指示で正本YAMLを1件作る。
 *
 * **Coreの保存経路の制約をそのまま課す。** content root外へは書かない。既存
 * ファイルは上書きしない（`wx`）。共通契約を満たさないものは書かない。
 * プラグインへはpathを渡さず、ここで組み立てる。
 */
export async function createPluginResource(
  contentRoot: string,
  draft: PluginResourceDraft & { name: string }
): Promise<{ name: string; relativePath: string }> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.name)) {
    throw new RuntimeError("metadata.nameが不正です", 400, "INVALID_NAME");
  }
  const folder = safeFolder(draft.folder);
  const relativePath = folder ? `${folder}/${draft.name}.yaml` : `${draft.name}.yaml`;
  const rootReal = await realpath(contentRoot);
  const target = path.join(contentRoot, relativePath);
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const directoryReal = await realpath(directory);
  // content root直下も許す。`isInside`は同一pathを内側と見なさない。
  if (directoryReal !== rootReal && !isInside(rootReal, directoryReal)) {
    throw new RuntimeError("contentRoot外への作成は許可されていません", 422, "PATH_BOUNDARY");
  }

  const resource = {
    apiVersion: STABLE_API_VERSION,
    kind: draft.kind,
    metadata: { name: draft.name, title: draft.title },
    spec: draft.spec
  };
  const output = stringify(resource, { lineWidth: 0, blockQuote: "literal" });
  if (!validateResource(JSON.parse(JSON.stringify(resource)), relativePath).resource) {
    throw new RuntimeError("作成するリソースの検証に失敗しました", 422, "PLUGIN_CREATE_VALIDATION");
  }
  await writeFile(target, output, { encoding: "utf8", flag: "wx" });
  return { name: draft.name, relativePath };
}
