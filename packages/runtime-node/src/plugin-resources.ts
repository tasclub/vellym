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

/** 書き込み前にも作成先を確定し、command応答と初回保存で同じpathを使う */
export function pluginResourceRelativePath(
  draft: PluginResourceDraft & { name: string }
): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.name)) {
    throw new RuntimeError("metadata.nameが不正です", 400, "INVALID_NAME");
  }
  const folder = safeFolder(draft.folder);
  return folder ? `${folder}/${draft.name}.yaml` : `${draft.name}.yaml`;
}

/** HTTP境界で、公開契約に無い作成指示を正本へ流さない */
export function parsePluginResourceDraft(
  value: unknown
): PluginResourceDraft & { name: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("resource draftが不正です", 400, "INVALID_RESOURCE_DRAFT");
  }
  const draft = value as Record<string, unknown>;
  if (
    typeof draft.kind !== "string" ||
    typeof draft.name !== "string" ||
    typeof draft.title !== "string" ||
    !draft.spec ||
    typeof draft.spec !== "object" ||
    Array.isArray(draft.spec)
  ) {
    throw new RuntimeError("resource draftが不正です", 400, "INVALID_RESOURCE_DRAFT");
  }
  const optionalString = (key: "slug" | "folder") => {
    const item = draft[key];
    if (item !== undefined && typeof item !== "string") {
      throw new RuntimeError(`resource draftの${key}が不正です`, 400, "INVALID_RESOURCE_DRAFT");
    }
    return item as string | undefined;
  };
  const optionalMap = (key: "labels" | "annotations") => {
    const item = draft[key];
    if (item === undefined) return undefined;
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.values(item as Record<string, unknown>).some((entry) => typeof entry !== "string")
    ) {
      throw new RuntimeError(`resource draftの${key}が不正です`, 400, "INVALID_RESOURCE_DRAFT");
    }
    return item as Record<string, string>;
  };
  const parsed: PluginResourceDraft & { name: string } = {
    kind: draft.kind,
    name: draft.name,
    title: draft.title,
    spec: draft.spec as Record<string, unknown>
  };
  const slug = optionalString("slug");
  const folder = optionalString("folder");
  const labels = optionalMap("labels");
  const annotations = optionalMap("annotations");
  if (slug !== undefined) parsed.slug = slug;
  if (folder !== undefined) parsed.folder = folder;
  if (labels !== undefined) parsed.labels = labels;
  if (annotations !== undefined) parsed.annotations = annotations;
  pluginResourceRelativePath(parsed);
  return parsed;
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
  const relativePath = pluginResourceRelativePath(draft);
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
    metadata: {
      name: draft.name,
      title: draft.title,
      ...(draft.slug === undefined ? {} : { slug: draft.slug }),
      ...(draft.labels === undefined ? {} : { labels: draft.labels }),
      ...(draft.annotations === undefined ? {} : { annotations: draft.annotations })
    },
    spec: draft.spec
  };
  const output = stringify(resource, { lineWidth: 0, blockQuote: "literal" });
  if (!validateResource(JSON.parse(JSON.stringify(resource)), relativePath).resource) {
    throw new RuntimeError("作成するリソースの検証に失敗しました", 422, "PLUGIN_CREATE_VALIDATION");
  }
  try {
    // `wx`は未作成リソースのnull baselineである。同名が先に作られたら上書きしない。
    await writeFile(target, output, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new RuntimeError("同じ名前のリソースが既にあります", 409, "RESOURCE_CREATE_CONFLICT");
    }
    throw error;
  }
  return { name: draft.name, relativePath };
}
