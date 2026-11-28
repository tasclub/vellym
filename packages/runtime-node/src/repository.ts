import { open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  isAlias,
  isNode,
  parseAllDocuments,
  visit,
  type Document
} from "yaml";
import {
  knownRichTextBlocks,
  knownRichTextBlocksFrom,
  projectFolder,
  projectPage,
  publishedPageLocales,
  validateFolder,
  validatePage,
  type Diagnostic,
  type FolderSummary,
  type FolderEditView,
  type PageEditView,
  type PageView,
  type PageSummary
} from "@vellym-internal/core";
import type {
  PluginDefinitionContext,
  PluginFileKindContribution,
  PluginFileRecord,
  PluginFileSetValidator,
  PluginDiagnostic,
  PluginIndexRow,
  PluginRecordProjectorFactory,
  PluginRecordSetValidator,
  PluginResourceRecord
} from "@vellym/plugin-api";
import { RuntimeError } from "./errors.js";
import { excludedDirectoriesFor } from "./management-root.js";
import { contentHash } from "./path-utils.js";
import { folderLocaleHashes, pageLocaleHashes } from "./locale-hash.js";
import type {
  LoadedPage,
  RepositorySnapshot
} from "./types.js";
import {
  BASE_LOCALE_KEY,
  deriveRepositoryEntryIndex,
  extractPageEntryWithPage,
  isPublishedProjection,
  pageReferencePath,
  pageRelationsView,
  searchRepositoryEntries,
  type PageEntry
} from "./repository-entry.js";

export async function loadCanonicalPage(
  contentRoot: string,
  loaded: LoadedPage
): Promise<PageView["page"]> {
  const sourcePath = path.join(contentRoot, loaded.relativePath);
  const source = await readFile(sourcePath, "utf8");
  const extracted = extractPageEntryWithPage({
    sourcePath,
    relativePath: loaded.relativePath,
    source,
    mtimeMs: 0,
    size: Buffer.byteLength(source)
  });
  if (extracted.kind !== "entry") {
    throw new RuntimeError("Pageを読み込めません", 422, "PAGE_READ");
  }
  return extracted.page;
}

/**
 * 文書ツリーへ出さない置き場所か。
 *
 * `_`または`+`で始まるフォルダの配下を隠す。`_`は一覧からも除外する置き場所、
 * `+`は一覧には出す機械用の置き場所である。ここではツリー表示だけを判定し、
 * 一覧から除外するかどうかは各一覧の別の判定に委ねる。
 * **隠すだけで、読み込みからは外さない。** 全文検索と内部リンクからは到達でき、
 * ファイルにも触れない。整理は利用者の作業であり、Vellymは自動で移動も削除もしない。
 */
export function isHiddenPath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .slice(0, -1)
    .some((segment) => segment.startsWith("_") || segment.startsWith("+"));
}

/** 既知kindの集合が同じか。増分読み込みで前回の結果を使えるかの判定に使う */
function sameKinds(
  left: ReadonlySet<string> | undefined,
  right: ReadonlySet<string> | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return (left?.size ?? 0) === (right?.size ?? 0);
  if (left.size !== right.size) return false;
  for (const kind of left) if (!right.has(kind)) return false;
  return true;
}

function kindSchemaSignature(
  schemas: ReadonlyMap<string, import("@vellym/plugin-api").PluginKindContribution["specSchema"]> | undefined
): string | undefined {
  if (!schemas?.size) return undefined;
  return JSON.stringify([...schemas.entries()]
    .sort(([left], [right]) => left.localeCompare(right)));
}

const ignoredDirectories = new Set([
  ".git",
  "_archive",
  "node_modules",
  "dist",
  "coverage"
]);

function matchesFileKind(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${escaped}$`).test(name);
}

async function findRepositoryEntries(
  root: string,
  fileKinds: LoadRepositoryOptions["fileKinds"]
): Promise<{
  files: string[];
  pluginPaths: string[];
  directories: string[];
}> {
  const files: string[] = [];
  const pluginPaths: string[] = [];
  const patterns = [...(fileKinds?.values() ?? [])].flat();
  const excluded = new Set(await excludedDirectoriesFor(root));
  const directories: string[] = [root];
  async function visitDirectory(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && !excluded.has(path.resolve(target))) {
          directories.push(target);
          await visitDirectory(target);
        }
      } else if (entry.isFile()) {
        if (/\.ya?ml$/i.test(entry.name) && entry.name !== "_index.yaml") files.push(target);
        if (patterns.some((kind) => matchesFileKind(entry.name, kind.pattern))) pluginPaths.push(target);
      }
    }
  }
  await visitDirectory(root);
  return { files, pluginPaths, directories };
}

function folderDiagnostic(
  file: string,
  code: string,
  message: string
): Diagnostic {
  return { file, severity: "error", code, message };
}

async function loadFolderSummaries(
  contentRoot: string,
  directories: string[],
  diagnostics: Diagnostic[]
): Promise<{
  summaries: FolderSummary[];
  resources: RepositorySnapshot["folderResources"];
}> {
  const summaries: FolderSummary[] = [];
  const resources: RepositorySnapshot["folderResources"] = new Map();
  for (const directory of directories) {
    const relative = path.relative(contentRoot, directory).replaceAll("\\", "/");
    const name = relative ? path.basename(directory) : "";
    const fallbackTitle = name || "文書";
    const indexPath = path.join(directory, "_index.yaml");
    const relativeIndex = relative ? `${relative}/_index.yaml` : "_index.yaml";
    let title = fallbackTitle;
    let description: string | undefined;
    let order: string[] = [];
    let readOnly = false;
    let folderHash: string | undefined;
    let folderResource: import("@vellym-internal/core").Folder | undefined;
    const readOnlyReasons: string[] = [];
    try {
      const source = await readFile(indexPath, "utf8");
      folderHash = contentHash(source);
      const documents = parseAllDocuments(source, { keepSourceTokens: true });
      const first = documents[0];
      if (!first || first.errors.length || documents.length !== 1) {
        throw new Error(
          first?.errors[0]?.message ?? "単一YAML documentではありません"
        );
      }
      const value = first.toJS({ maxAliasCount: 100 });
      const validated = validateFolder(value, relativeIndex);
      diagnostics.push(...validated.diagnostics);
      if (!validated.folder) throw new Error("Folder resourceの必須項目が不正です");
      const folder = validated.folder;
      folderResource = folder;
      const spec = folder.spec;
      title = folder.metadata.title;
      if (spec.description !== undefined) {
        if (typeof spec.description !== "string") {
          throw new Error("spec.descriptionは文字列で指定してください");
        }
        description = spec.description;
      }
      if (spec.order !== undefined) {
        if (
          !Array.isArray(spec.order) ||
          spec.order.some(
            (item) =>
              typeof item !== "string" ||
              !item ||
              item === "." ||
              item === ".." ||
              item === "_index.yaml" ||
              /[\/\\\0]/.test(item)
          ) ||
          new Set(spec.order).size !== spec.order.length
        ) {
          throw new Error("spec.orderが不正です");
        }
        order = spec.order as string[];
      }
      const unsafeReasons = unsafeYamlReasons(first, documents.length);
      if (unsafeReasons.length) {
        readOnly = true;
        readOnlyReasons.push(...unsafeReasons);
      }
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        readOnly = true;
        const message = error instanceof Error ? error.message : String(error);
        readOnlyReasons.push(message);
        diagnostics.push(
          folderDiagnostic(relativeIndex, "FOLDER_METADATA", message)
        );
      }
    }
    const summary: FolderSummary = {
      path: relative,
      name,
      title,
      ...(description === undefined ? {} : { description }),
      order,
      readOnly,
      readOnlyReasons,
      ...(folderHash ? { hash: folderHash } : {})
    };
    summaries.push(summary);
    if (folderResource) {
      resources.set(relative, {
        resource: folderResource,
        sourcePath: indexPath,
        summary,
        hash: folderHash!
      });
    }
  }
  return { summaries, resources };
}

function unsafeYamlReasons(document: Document.Parsed, documentCount: number): string[] {
  const reasons = new Set<string>();
  if (documentCount !== 1) reasons.add("複数YAML documentを含むため編集できません");
  visit(document, (_key, node) => {
    if (isAlias(node)) reasons.add("aliasを含むため編集できません");
    if (isNode(node)) {
      const annotated = node as typeof node & { anchor?: string; tag?: string };
      if (annotated.anchor) reasons.add("anchorを含むため編集できません");
      if (annotated.tag && !annotated.tag.startsWith("tag:yaml.org,2002:")) {
        reasons.add("custom tagを含むため編集できません");
      }
    }
  });
  return [...reasons];
}

async function assertContentRoot(contentRoot: string): Promise<void> {
  try {
    const info = await stat(contentRoot);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new RuntimeError(
      `contentRootが見つからないかディレクトリではありません: ${contentRoot}`,
      400,
      "CONTENT_ROOT_NOT_FOUND"
    );
  }
}

async function statRepositoryFiles(
  files: string[]
): Promise<Map<string, { mtimeMs: number; size: number }>> {
  const result = new Map<string, { mtimeMs: number; size: number }>();
  const batchSize = 256;
  for (let offset = 0; offset < files.length; offset += batchSize) {
    const batch = files.slice(offset, offset + batchSize);
    const values = await Promise.all(batch.map(async (file) => {
      const info = await stat(file);
      return [file, { mtimeMs: info.mtimeMs, size: info.size }] as const;
    }));
    for (const [file, info] of values) result.set(file, info);
  }
  return result;
}

export interface LoadRepositoryOptions {
  /**
   * 有効なプラグインが解釈できるkind。渡さなければCore組み込みだけを既知とする。
   *
   * プラグインを外せば同じファイルが未知kindの扱いへ戻る。読み込みの結果が
   * プラグインの有無で変わるのはここだけであり、正本YAMLは変わらない。
   */
  knownKinds?: ReadonlySet<string>;
  /**
   * `knownKinds`のうち、文書ツリーへ出すkind。プラグインが宣言する。
   * チケット本体のように、読めるが木には出さないkindはここへ入れない。
   */
  treeKinds?: ReadonlySet<string>;
  /** kindごとのプラグイン固有spec schema */
  kindSchemas?: ReadonlyMap<string, import("@vellym/plugin-api").PluginKindContribution["specSchema"]>;
  /**
   * kindごとの索引行の作り方。プラグインが`registerRecordProjection`で登録する。
   *
   * **projectorを登録したkindは「大量にあるデータ」として扱う。** 完全な
   * リソースを常駐させず、返された索引行だけを保持する。登録が無いプラグイン
   * kindは「定義」として扱い、projectorを組み立てる文脈から読めるようにする。
   * 数の多いものと少ないものを、登録の有無だけで区別する。
   */
  projections?: ReadonlyMap<string, PluginRecordProjectorFactory>;
  /**
   * kindごとの「索引行全体を検査する関数」。プラグインが
   * `registerRecordSetValidator`で登録する。
   *
   * hostはkindについて何も知らないまま、索引行がすべてそろった後に
   * 1回ずつ呼ぶ。同じkindへ複数登録してよい。同じ関数（同じ参照）は
   * 1回だけ実行し、返された診断は`file`・`path`・`code`で重複を除く。
   */
  recordSetValidators?: ReadonlyMap<string, PluginRecordSetValidator[]>;
  fileKinds?: ReadonlyMap<string, readonly PluginFileKindContribution[]>;
  fileSetValidators?: ReadonlyMap<string, ReadonlyMap<string, PluginFileSetValidator[]>>;
}

async function loadPluginFiles(
  contentRoot: string,
  paths: readonly string[],
  options: LoadRepositoryOptions,
  definitions: readonly PluginResourceRecord[],
  diagnostics: Diagnostic[]
): Promise<RepositorySnapshot["pluginFiles"]> {
  const result = new Map<string, readonly PluginFileRecord[]>();
  const seen = new Set(diagnostics.map(diagnosticDedupKey));
  const report = (item: PluginDiagnostic): void => {
    const key = diagnosticDedupKey(item);
    if (!seen.has(key)) { seen.add(key); diagnostics.push({ ...item }); }
  };
  const context: PluginDefinitionContext = {
    records: (kind) => definitions.filter((record) => record.kind === kind),
    reportDiagnostic: report
  };
  for (const [pluginId, kinds] of options.fileKinds ?? []) {
    const records = new Map<string, PluginFileRecord>();
    const byKind = new Map<string, PluginFileRecord[]>();
    for (const kind of kinds) {
      const accepted: PluginFileRecord[] = [];
      byKind.set(kind.id, accepted);
      for (const sourcePath of paths) {
        if (!matchesFileKind(path.basename(sourcePath), kind.pattern)) continue;
        const relativePath = path.relative(contentRoot, sourcePath).replaceAll("\\", "/");
        try {
          // Read at most the limit plus one, even if a file grows after discovery.
          const handle = await open(sourcePath, "r");
          let bytes: Buffer;
          try {
            if ((await handle.stat()).size > kind.maxBytes) {
              report({ file: relativePath, severity: "error", code: "PLUGIN_FILE_TOO_LARGE",
                message: { ja: `ファイルが上限の${kind.maxBytes}バイトを超えています`,
                  en: `The file exceeds the limit of ${kind.maxBytes} bytes` } });
              continue;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            while (total <= kind.maxBytes) {
              const chunk = Buffer.alloc(Math.min(64 * 1024, kind.maxBytes - total + 1));
              const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
              if (!bytesRead) break;
              chunks.push(chunk.subarray(0, bytesRead));
              total += bytesRead;
            }
            bytes = Buffer.concat(chunks);
          } finally { await handle.close(); }
          if (bytes.length > kind.maxBytes) {
            report({ file: relativePath, severity: "error", code: "PLUGIN_FILE_TOO_LARGE",
              message: { ja: `ファイルが上限の${kind.maxBytes}バイトを超えています`,
                en: `The file exceeds the limit of ${kind.maxBytes} bytes` } });
            continue;
          }
          let value: unknown;
          try { value = JSON.parse(bytes.toString("utf8")); } catch {
            report({ file: relativePath, severity: "error", code: "PLUGIN_FILE_JSON_INVALID",
              message: { ja: "JSONファイルを解析できません", en: "Could not parse the JSON file" } });
            continue;
          }
          const record = { relativePath, hash: createHash("sha256").update(bytes).digest("hex"), value };
          records.set(relativePath, record);
          accepted.push(record);
        } catch {
          report({ file: relativePath, severity: "error", code: "PLUGIN_FILE_READ_FAILED",
            message: { ja: "ファイルを読み込めません", en: "Could not read the file" } });
        }
      }
      accepted.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }
    result.set(pluginId, [...records.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath)));
    for (const [id, validators] of options.fileSetValidators?.get(pluginId) ?? []) {
      if (!byKind.has(id)) continue;
      for (const validate of new Set(validators)) {
        try {
          for (const item of validate(byKind.get(id)!, {
            ...context, pluginFiles: Object.fromEntries(byKind)
          }) ?? []) report(item);
        } catch {
          report({ file: ".", path: `${pluginId}/${id}`, severity: "warning",
            code: "PLUGIN_FILE_SET_VALIDATION_FAILED",
            message: { ja: `ファイル種別${id}の検査が失敗しました`,
              en: `The file set check for ${id} failed` } });
        }
      }
    }
  }
  return result;
}

/** 抽出済みリソースからプラグインへ渡すレコードを作る。pathもFSも渡さない */
function pluginRecord(
  page: import("@vellym-internal/core").Page,
  entry: PageEntry
): PluginResourceRecord {
  return {
    kind: entry.kind,
    name: entry.name,
    title: entry.title,
    ...(entry.slug === entry.name ? {} : { slug: entry.slug }),
    relativePath: entry.relativePath,
    hash: entry.hash,
    ...(entry.configuredBaseLocale ? { locale: entry.configuredBaseLocale } : {}),
    ...(entry.labels ? { labels: entry.labels } : {}),
    ...(entry.annotations ? { annotations: entry.annotations } : {}),
    spec: page.spec as Readonly<Record<string, unknown>>,
    readOnly: entry.readOnly
  };
}

/** 定義リソースの顔ぶれ。変わったら索引行を作り直す必要がある */
function definitionSignature(records: readonly PluginResourceRecord[]): string {
  return records
    .map((record) => `${record.kind}\0${record.name}\0${JSON.stringify(record.spec)}`)
    .sort()
    .join("\n");
}

/** 重複除去の鍵。同じfile・path・codeは1度だけ出す */
function diagnosticDedupKey(diagnostic: { file: string; path?: string; code: string }): string {
  return `${diagnostic.file}\0${diagnostic.path ?? ""}\0${diagnostic.code}`;
}

/**
 * 同じkindの索引行全体を、登録された検査関数へ渡す。
 *
 * **hostはkindについて何も知らない。** 行を`PluginIndexRow`の形へ組み立てて
 * 渡すだけで、中身の解釈はプラグイン側にある。検査が投げても読み込みは続け、
 * 警告にとどめる（1つの検査の失敗で一覧を丸ごと失わない）。
 * 返された診断は`file`・`path`・`code`で重複を除いて足す。複数のプラグインが
 * 同じエンジンを同梱して同じ診断を返しても、利用者には1度だけ見える。
 */
function runRecordSetValidators(
  entries: readonly PageEntry[],
  validators: ReadonlyMap<string, PluginRecordSetValidator[]>,
  context: PluginDefinitionContext,
  diagnostics: Diagnostic[]
): void {
  const seen = new Set(diagnostics.map(diagnosticDedupKey));
  for (const [kind, list] of validators) {
    if (!list.length) continue;
    const rows: PluginIndexRow[] = [];
    for (const entry of entries) {
      if (entry.kind !== kind || !entry.indexRow) continue;
      rows.push({ name: entry.name, title: entry.title, values: entry.indexRow });
    }
    for (const validate of list) {
      let produced: readonly PluginDiagnostic[];
      try {
        produced = validate(rows, context);
      } catch (error) {
        diagnostics.push({
          file: ".",
          severity: "warning",
          code: "PLUGIN_RECORD_SET_VALIDATION_FAILED",
          message: {
            ja: `kind ${kind}の索引行の検査が失敗しました: ${
              error instanceof Error ? error.message : String(error)
            }`,
            en: `The index row check for kind ${kind} failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          }
        });
        continue;
      }
      for (const item of produced ?? []) {
        const key = diagnosticDedupKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        diagnostics.push({ ...item });
      }
    }
  }
}

function localizedReferenceMessage(
  message: Diagnostic["message"],
  locale: "ja" | "en"
): string {
  if (typeof message === "string") return message;
  return message[locale] ?? message.en ?? message.ja ?? Object.values(message)[0] ?? "";
}

function repositoryReferenceDiagnostics(
  entryIndex: RepositorySnapshot["entryIndex"]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const reference of entryIndex.referenceDiagnostics) {
    const source = entryIndex.byName.get(reference.pageId);
    if (!source || !isPublishedProjection(source, reference.locale)) continue;
    const diagnosticPath = pageReferencePath(
      source,
      reference.locale,
      reference.blockId
    );
    if (diagnosticPath === undefined) {
      throw new Error(
        `参照診断のblock位置がありません: ${reference.file} ${reference.pageId} ${reference.blockId}`
      );
    }
    const key = `${reference.file}\u0000${diagnosticPath}\u0000${reference.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      file: reference.file,
      path: diagnosticPath,
      severity: "warning",
      code: reference.code,
      message: {
        ja: `ファイル ${reference.file} のPage ${reference.pageId}（locale ${reference.locale || "base"}、block ${reference.blockId}、target ${reference.target}）: ${localizedReferenceMessage(reference.message, "ja")}`,
        en: `File ${reference.file}, Page ${reference.pageId} (locale ${reference.locale || "base"}, block ${reference.blockId}, target ${reference.target}): ${localizedReferenceMessage(reference.message, "en")}`
      }
    });
  }
  return diagnostics;
}

export async function loadRepository(
  contentRoot: string,
  previous?: RepositorySnapshot,
  options: LoadRepositoryOptions = {}
): Promise<RepositorySnapshot> {
  await assertContentRoot(contentRoot);
  const { files, pluginPaths, directories } = await findRepositoryEntries(contentRoot, options.fileKinds);
  const fileStats = await statRepositoryFiles(files);
  const entries: PageEntry[] = [];
  // projectorを持つkind（＝大量にあるデータ）。定義を読み終えるまで索引行を作れない
  // ため、いったん保持してから最後にまとめて落とす。ここが常駐しないよう、
  // 索引行を作った時点でレコードを捨てる。
  const pendingProjection: Array<{ entry: PageEntry; record: PluginResourceRecord }> = [];
  // projectorを持たないプラグインkind（＝定義）。数が少ない前提で保持する。
  const definitionRecords: PluginResourceRecord[] = [];
  let reusedAnyEntry = false;
  const previousEntries = new Map(
    (previous?.entryIndex.pages ?? []).map((entry) => [entry.relativePath, entry])
  );
  const previousDefinitions = new Map(
    (previous?.definitionRecords ?? []).map((record) => [record.relativePath, record])
  );
  const diagnostics: Diagnostic[] = [];
  const knownKindsUnchanged =
    previous === undefined ||
    (sameKinds(previous.knownKinds, options.knownKinds) &&
      previous.kindSchemaSignature === kindSchemaSignature(options.kindSchemas));
  const loadedFolders = await loadFolderSummaries(
    contentRoot,
    directories,
    diagnostics
  );
  const folders = loadedFolders.summaries;

  for (const sourcePath of files) {
    const relativePath = path.relative(contentRoot, sourcePath).replaceAll("\\", "/");
    const info = fileStats.get(sourcePath)!;
    const previousEntry = previousEntries.get(relativePath);
    if (
      previousEntry &&
      previousEntry.mtimeMs === info.mtimeMs &&
      previousEntry.size === info.size &&
      // 既知kindの集合が変われば解釈も変わる。前回の結果を使い回せない。
      knownKindsUnchanged
    ) {
      entries.push(previousEntry);
      const definition = previousDefinitions.get(relativePath);
      if (definition) definitionRecords.push(definition);
      reusedAnyEntry = true;
      continue;
    }
    let source: string;
    try {
      source = await readFile(sourcePath, "utf8");
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
      const code = typeof errorCode === "string" ? errorCode : undefined;
      diagnostics.push({
        file: relativePath,
        severity: "error",
        code: "READ_ERROR",
        message: {
          ja: `ファイルを読めません${code === undefined ? "" : `（${code}）`}`,
          en: `Could not read the file${code === undefined ? "" : ` (${code})`}`
        }
      });
      continue;
    }
    const extracted = extractPageEntryWithPage({
      sourcePath,
      relativePath,
      source,
      mtimeMs: info.mtimeMs,
      size: info.size,
      ...(options.knownKinds ? { knownKinds: options.knownKinds } : {}),
      ...(options.kindSchemas ? { kindSchemas: options.kindSchemas } : {})
    });
    diagnostics.push(...extracted.diagnostics);
    if (extracted.kind !== "entry") continue;
    entries.push(extracted.entry);
    const kind = extracted.entry.kind;
    if (kind !== "Page" && options.knownKinds?.has(kind)) {
      const record = pluginRecord(extracted.page, extracted.entry);
      if (options.projections?.has(kind)) {
        pendingProjection.push({ entry: extracted.entry, record });
      } else {
        definitionRecords.push(record);
      }
    }
  }

  if (options.projections?.size || options.recordSetValidators?.size) {
    const context: PluginDefinitionContext = {
      records: (kind: string): readonly PluginResourceRecord[] =>
        definitionRecords.filter((record) => record.kind === kind),
      reportDiagnostic: (diagnostic: PluginDiagnostic) =>
        diagnostics.push({ ...diagnostic })
    };
    const projectors = new Map<string, ReturnType<PluginRecordProjectorFactory>>();
    for (const [kind, create] of options.projections ?? []) {
      try {
        projectors.set(kind, create(context));
      } catch (error) {
        // プラグインが投げても読み込みは続ける。そのkindの索引行が無いだけにする。
        diagnostics.push({
          file: ".",
          severity: "warning",
          code: "PLUGIN_PROJECTION_FAILED",
          message: {
            ja: `kind ${kind}の索引を作れませんでした: ${
              error instanceof Error ? error.message : String(error)
            }`,
            en: `Could not create an index for kind ${kind}: ${
              error instanceof Error ? error.message : String(error)
            }`
          }
        });
      }
    }
    for (const { entry, record } of pendingProjection) {
      const project = projectors.get(entry.kind);
      if (!project) continue;
      try {
        const projection = project(record);
        if (!projection) continue;
        entry.indexRow = projection.values;
        if (projection.diagnostics?.length) diagnostics.push(...projection.diagnostics);
      } catch (error) {
        diagnostics.push({
          file: entry.relativePath,
          severity: "warning",
          code: "PLUGIN_PROJECTION_FAILED",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // 索引行がそろった後、行をまたぐ検査を1回だけ走らせる。projectorは
    // レコード1件ずつしか見えないため、参照の解決や循環はここでやる。
    // 索引を作り直す経路（上の読み込み全体）はすべてここを通る。
    if (options.recordSetValidators?.size) {
      runRecordSetValidators(entries, options.recordSetValidators, context, diagnostics);
    }
  }
  pendingProjection.length = 0;

  // 定義が変わると、使い回した項目の索引行が古いままになる。顔ぶれが変わっていたら
  // 増分をあきらめて読み直す。定義の変更は稀なので、単純さを優先する。
  const signature = definitionSignature(definitionRecords);
  if (previous && reusedAnyEntry && previous.definitionSignature !== undefined &&
      previous.definitionSignature !== signature) {
    return loadRepository(contentRoot, undefined, options);
  }

  const entryIndex = deriveRepositoryEntryIndex(entries);
  const pluginFiles = await loadPluginFiles(contentRoot, pluginPaths, options, definitionRecords, diagnostics);
  diagnostics.push(...entryIndex.diagnostics);
  diagnostics.push(...repositoryReferenceDiagnostics(entryIndex));
  for (const folder of folders) {
    if (!folder.order.length) continue;
    const childNames = new Set<string>();
    for (const childFolder of folders) {
      if (!childFolder.path) continue;
      const parent = path.posix.dirname(childFolder.path);
      if ((parent === "." ? "" : parent) === folder.path) {
        childNames.add(path.posix.basename(childFolder.path));
      }
    }
    for (const page of entryIndex.pages) {
      const normalized = page.relativePath;
      const parent = path.posix.dirname(normalized);
      if ((parent === "." ? "" : parent) === folder.path) {
        childNames.add(path.posix.basename(normalized));
      }
    }
    for (const item of folder.order) {
      if (childNames.has(item)) continue;
      diagnostics.push({
        file: folder.path ? `${folder.path}/_index.yaml` : "_index.yaml",
        path: "/spec/order",
        severity: "error",
        code: "FOLDER_ORDER_MISSING",
        message: {
          ja: `存在しない子がorderに含まれています: ${item}`,
          en: `The order includes a child that does not exist: ${item}`
        }
      });
    }
  }
  return {
    contentRoot,
    pluginFiles,
    ...(options.knownKinds ? { knownKinds: options.knownKinds } : {}),
    ...(options.treeKinds ? { treeKinds: options.treeKinds } : {}),
    ...(options.kindSchemas ? { kindSchemaSignature: kindSchemaSignature(options.kindSchemas) } : {}),
    ...(options.projections?.size ? { definitionSignature: signature } : {}),
    ...(definitionRecords.length ? { definitionRecords } : {}),
    entryIndex,
    pages: entryIndex.pages,
    byName: entryIndex.byName,
    bySlug: entryIndex.bySlug,
    folders,
    folderResources: loadedFolders.resources,
    diagnostics
  };
}

export function pageSummaries(snapshot: RepositorySnapshot): PageSummary[] {
  return snapshot.pages.map((entry) => ({
    name: entry.name,
    slug: entry.slug,
    title: entry.title,
    relativePath: entry.relativePath,
    readOnly: entry.readOnly,
    resourceKind: entry.kind
  }));
}

/**
 * Resources of a kind no installed plugin interprets, grouped by kind. Vellym never moves,
 * deletes or converts them; tidying up is the user's job.
 */
export interface UnknownKindGroup {
  kind: string;
  count: number;
  resources: Array<{ name: string; title: string; relativePath: string }>;
}

/**
 * The "uninterpreted content" aggregate. Such resources stay readable as body-only documents
 * through search and links, but appear in no tree; this tells the user where they are.
 */
export function unknownKindGroups(snapshot: RepositorySnapshot): UnknownKindGroup[] {
  const byKind = new Map<string, UnknownKindGroup["resources"]>();
  for (const entry of snapshot.pages) {
    // Folders starting with "_" (archive, set-aside material) stay out; "+" folders are machine
    // stores of listed content (such as +tickets) and count.
    const setAside = entry.relativePath.split("/").slice(0, -1).some((segment) => segment.startsWith("_"));
    if (entry.kind === "Page" || entry.kind === "Folder" || snapshot.knownKinds?.has(entry.kind) || setAside) continue;
    const items = byKind.get(entry.kind) ?? [];
    items.push({ name: entry.name, title: entry.title, relativePath: entry.relativePath });
    byKind.set(entry.kind, items);
  }
  return [...byKind].sort(([a], [b]) => a.localeCompare(b)).map(([kind, resources]) => ({
    kind, count: resources.length, resources: resources.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  }));
}

export function searchRepository(snapshot: RepositorySnapshot, query: string) {
  return searchRepositoryEntries(snapshot.entryIndex, query);
}

export function localizedPageSummaries(
  snapshot: RepositorySnapshot,
  locale: string,
  defaultLocale: string
): PageSummary[] {
  const cacheKey = `${locale}\0${defaultLocale}`;
  const cached = snapshot.entryIndex.localizedSummaryCache.get(cacheKey);
  if (cached) return cached;
  // 文書ツリーと一覧に載せるのは、kind: Pageと、プラグインが「木へ出す」と
  // 宣言したkindだけである。解釈できないkindは「未知の内容」として別に集約する。
  // 検索と内部リンクからは引き続き到達できる。
  const inTree = (kind: string): boolean =>
    kind === "Page" || snapshot.treeKinds?.has(kind) === true;
  const summaries = snapshot.pages
    .filter(({ kind, relativePath }) => inTree(kind) && !isHiddenPath(relativePath))
    .map((entry) => {
    const translation = locale === defaultLocale ? undefined : entry.translations?.get(locale);
    const record = translation?.visibility === "published" ? translation : entry.base;
    return {
      name: entry.name,
      slug: entry.slug,
      title: record.title,
      relativePath: entry.relativePath,
      readOnly: entry.readOnly,
      resourceKind: entry.kind,
      locale: record.locale ?? entry.configuredBaseLocale ?? defaultLocale,
      baseLocale: entry.configuredBaseLocale ?? defaultLocale
    };
  });
  snapshot.entryIndex.localizedSummaryCache.set(cacheKey, summaries);
  return summaries;
}

export function localizedFolderSummaries(
  snapshot: RepositorySnapshot,
  locale: string,
  defaultLocale: string
): FolderSummary[] {
  const visiblePages = localizedPageSummaries(snapshot, locale, defaultLocale);
  const visibleFolderPaths = new Set<string>([""]);
  for (const page of visiblePages) {
    const parts = page.relativePath.replaceAll("\\", "/").split("/").slice(0, -1);
    for (let index = 1; index <= parts.length; index += 1) {
      visibleFolderPaths.add(parts.slice(0, index).join("/"));
    }
  }
  const requestedIsDefault = locale === defaultLocale;
  return snapshot.folders
    .filter((summary) => !isHiddenPath(`${summary.path}/x`))
    .filter((summary) => requestedIsDefault || visibleFolderPaths.has(summary.path))
    .map((summary) => {
    const loaded = snapshot.folderResources.get(summary.path);
    if (!loaded) return summary;
    const projection = projectFolder(
      loaded.resource,
      locale,
      defaultLocale,
      summary.path ? `${summary.path}/_index.yaml` : "_index.yaml"
    );
    if (!projection) return summary;
    return {
      ...summary,
      title: projection.folder.metadata.title,
      locale: projection.locale,
      baseLocale: projection.baseLocale,
      sourceLocale: projection.sourceLocale,
      localeHashes: folderLocaleHashes(loaded.resource, defaultLocale),
      ...(projection.folder.spec.description === undefined
        ? { description: undefined }
        : { description: projection.folder.spec.description })
    };
    });
}

export async function localizedPage(
  snapshot: RepositorySnapshot,
  pageId: string,
  locale: string,
  defaultLocale: string
): Promise<PageView | undefined> {
  const loaded = snapshot.byName.get(pageId);
  if (!loaded) return undefined;
  const canonicalPage = await loadCanonicalPage(snapshot.contentRoot, loaded);
  const baseLocale = resolvePageBaseLocale(canonicalPage, defaultLocale);
  if (!baseLocale) return undefined;
  const requestedProjection = projectPage(
    canonicalPage,
    locale,
    defaultLocale,
    loaded.relativePath
  );
  const projection = requestedProjection ?? projectPage(
    canonicalPage,
    baseLocale,
    defaultLocale,
    loaded.relativePath
  );
  const validation = validatePage(canonicalPage, loaded.relativePath);
  const availableLocales = publishedPageLocales(
    canonicalPage,
    defaultLocale,
    loaded.relativePath
  );
  if (!projection) return undefined;
  return {
    page: projection.page,
    knownBlocks: projection.knownBlocks,
    relativePath: loaded.relativePath,
    hash: loaded.hash,
    readOnly: loaded.readOnly,
    readOnlyReasons: loaded.readOnlyReasons ?? [],
    locale: projection.locale,
    requestedLocale: locale,
    baseLocale,
    availableLocales,
    editableLocales: [
      baseLocale,
      ...validation.translations.map(({ locale: item }) => item),
      ...validation.invalidTranslations.flatMap(({ canonicalLocale }) =>
        canonicalLocale ? [canonicalLocale] : []
      )
    ].filter((item, index, all) => all.indexOf(item) === index),
    isBaseLocale: projection.isBaseLocale,
    invalidTranslations: validation.invalidTranslations,
    localeHashes: pageLocaleHashes(canonicalPage, defaultLocale),
    relations: pageRelationsView(
      snapshot.entryIndex,
      canonicalPage.metadata.name,
      projection.isBaseLocale ? BASE_LOCALE_KEY : projection.locale
    )
  };
}

export async function editablePage(
  snapshot: RepositorySnapshot,
  pageId: string,
  defaultLocale: string
): Promise<PageEditView | undefined> {
  const loaded = snapshot.byName.get(pageId) ?? snapshot.bySlug.get(pageId);
  if (!loaded) return undefined;
  const canonicalPage = await loadCanonicalPage(snapshot.contentRoot, loaded);
  const validation = validatePage(canonicalPage, loaded.relativePath);
  const baseLocale = resolvePageBaseLocale(canonicalPage, defaultLocale);
  if (!baseLocale) return undefined;
  const hashes = pageLocaleHashes(canonicalPage, defaultLocale);
  return {
    pageId: canonicalPage.metadata.name,
    slug: canonicalPage.metadata.slug ?? canonicalPage.metadata.name,
    relativePath: loaded.relativePath,
    hash: loaded.hash,
    baseLocale,
    locales: [
      {
        locale: baseLocale,
        isBaseLocale: true,
        visibility: "published" as const,
        title: canonicalPage.metadata.title,
        blocks: knownRichTextBlocks(
          canonicalPage,
          loaded.relativePath
        ).blocks,
        baselineHash: hashes[baseLocale]!
      },
      ...validation.translations.map(({ locale, value, rawKey }) => ({
        locale,
        isBaseLocale: false,
        visibility: value.visibility ?? "published" as const,
        title: value.title,
        blocks: knownRichTextBlocksFrom(
          value.blocks ?? [],
          loaded.relativePath,
          `/spec/translations/${rawKey}/blocks`
        ).blocks,
        baselineHash: hashes[locale]!
      }))
    ],
    invalidTranslations: validation.invalidTranslations,
    readOnly: loaded.readOnly,
    readOnlyReasons: loaded.readOnlyReasons ?? []
  };
}

export function editableFolder(
  snapshot: RepositorySnapshot,
  folderPath: string,
  defaultLocale: string
): FolderEditView | undefined {
  const summary = snapshot.folders.find(({ path: item }) => item === folderPath);
  if (!summary) return undefined;
  const loaded = snapshot.folderResources.get(folderPath);
  const folder = loaded?.resource ?? {
    apiVersion: "vellym.tasclub.com/v1alpha1",
    kind: "Folder" as const,
    metadata: { title: summary.title },
    spec: summary.description === undefined ? {} : { description: summary.description }
  };
  const validation = validateFolder(folder, folderPath ? `${folderPath}/_index.yaml` : "_index.yaml");
  const baseLocale = resolveDefaultFolderLocale(folder, defaultLocale);
  if (!baseLocale) return undefined;
  const hashes = folderLocaleHashes(folder, defaultLocale);
  return {
    folderPath,
    hash: loaded?.hash ?? null,
    baseLocale,
    locales: [
      {
        locale: baseLocale,
        isBaseLocale: true,
        visibility: "published",
        title: folder.metadata.title,
        ...(folder.spec.description === undefined ? {} : { description: folder.spec.description }),
        baselineHash: hashes[baseLocale]!
      },
      ...validation.translations.map(({ locale, value }) => ({
        locale,
        isBaseLocale: false,
        visibility: value.visibility ?? "published" as const,
        title: value.title,
        ...(value.description === undefined ? {} : { description: value.description }),
        baselineHash: hashes[locale]!
      }))
    ],
    invalidTranslations: validation.invalidTranslations,
    readOnly: summary.readOnly,
    readOnlyReasons: summary.readOnlyReasons
  };
}

function resolveDefaultFolderLocale(
  folder: import("@vellym-internal/core").Folder,
  defaultLocale: string
): string | undefined {
  return projectFolder(folder, folder.spec.locale ?? defaultLocale, defaultLocale)?.baseLocale;
}

function resolvePageBaseLocale(page: PageView["page"], defaultLocale: string) {
  const projection = projectPage(page, page.spec.locale ?? defaultLocale, defaultLocale);
  return projection?.baseLocale;
}

export function localizedSearchRepository(
  snapshot: RepositorySnapshot,
  query: string,
  locale: string,
  defaultLocale: string
) {
  return searchRepositoryEntries(snapshot.entryIndex, query, { locale, defaultLocale });
}
