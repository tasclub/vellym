import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import satisfies from "semver/functions/satisfies.js";
import { validatePluginManifest, type Diagnostic } from "@vellym-internal/core";
import {
  PLUGIN_MANIFEST_FIELD,
  type PluginCommandContribution,
  type PluginCommandInput,
  type PluginKindContribution,
  type PluginManifest,
  type PluginDiagnostic,
  type PluginFilterDescriptor,
  type PluginLocalizedText,
  type PluginRecordProjectorFactory,
  type PluginViewContext,
  type PluginViewContribution,
  type PluginViewDescriptor,
  type PluginIndexValue,
  type PluginResourceRecord,
  type VellymPluginHost,
  type VellymPluginModule
} from "@vellym/plugin-api";

export interface LoadedPlugin {
  /** `plugins`へ書かれたパッケージ名 */
  packageName: string;
  /** manifestの`id`。配信pathに使う */
  id: string;
  version?: string;
  manifest: PluginManifest;
  /**
   * ブラウザ側の資産を置いた実path。`exports["./browser"]`が指す先の
   * ディレクトリである。宣言していないプラグインでは`undefined`になる。
   *
   * **宣言で表現できる画面はdescriptorだけで描かれる。** 多くのプラグインは
   * ブラウザ側を持たなくてよい。
   */
  browserRoot?: string;
  /** ブラウザ側エントリのファイル名。`browserRoot`からの相対 */
  browserEntry?: string;
  kinds: PluginKindContribution[];
  views: PluginViewContribution[];
  commands: PluginCommandContribution[];
  /** kind → 定義を読んでprojectorを作る関数 */
  projections: Map<string, PluginRecordProjectorFactory>;
}

export interface PluginRegistry {
  plugins: LoadedPlugin[];
  /** kind → それを解釈するプラグイン。先に登録した方が勝つ */
  kinds: Map<string, LoadedPlugin>;
  diagnostics: Diagnostic[];
}

/**
 * repositoryの読み込みへ渡す、kindの扱い。
 *
 * `known`は共通契約の範囲で読み進めるkind、`tree`はそのうち文書ツリーへ出すもの。
 * プラグインを外せば両方とも空になり、同じファイルが未知kindの扱いへ戻る。
 */
export function pluginKinds(registry: PluginRegistry): {
  knownKinds: ReadonlySet<string>;
  treeKinds: ReadonlySet<string>;
  projections: ReadonlyMap<string, PluginRecordProjectorFactory>;
} {
  const treeKinds = new Set<string>();
  const projections = new Map<string, PluginRecordProjectorFactory>();
  for (const plugin of registry.plugins) {
    for (const contribution of plugin.kinds) {
      // 所有するプラグインが1つに決まっているkindだけを対象にする。
      if (registry.kinds.get(contribution.kind) !== plugin) continue;
      if (contribution.showInDocumentTree) treeKinds.add(contribution.kind);
    }
    for (const [kind, create] of plugin.projections) {
      if (registry.kinds.get(kind) !== plugin) continue;
      projections.set(kind, create);
    }
  }
  return { knownKinds: new Set(registry.kinds.keys()), treeKinds, projections };
}

export interface LoadPluginsOptions {
  /** `vellym.config.yaml`のあるディレクトリ。解決はここを起点にする */
  configDir: string;
  packageNames: readonly string[];
  /** 実行中のVellym本体のversion */
  hostVersion: string;
}

/**
 * ブラウザ側エントリを、パッケージ自身の`exports`から解決する。
 *
 * 宣言していないプラグインでは`undefined`を返す。**失敗を診断にしない。**
 * ブラウザ側を持たないことは異常ではなく、宣言で表現できる画面は
 * descriptorだけで描かれる。
 */
function resolveBrowserEntry(
  requireFrom: NodeRequire,
  packageName: string
): { root: string; entry: string } | undefined {
  try {
    const resolved = requireFrom.resolve(`${packageName}/browser`);
    return { root: path.dirname(resolved), entry: path.basename(resolved) };
  } catch {
    return undefined;
  }
}

/** 診断が指す位置。プラグインの失敗は設定ファイルの`plugins`に帰着する */
const CONFIG_FILE = "vellym.config.yaml";

function diagnostic(
  index: number,
  code: string,
  message: string
): Diagnostic {
  return {
    file: CONFIG_FILE,
    path: `/plugins/${index}`,
    severity: "warning",
    code,
    message
  };
}

/**
 * 例外から利用者へ見せる1行を作る。Node解決の失敗はrequire stackを含む複数行に
 * なるため、先頭行だけを使う。診断が指すべきは設定の`plugins`であって、
 * Vellym内部のpathではない。
 */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? message;
}

/**
 * `plugins`に書かれたパッケージを解決し、`activate`を呼んで貢献点を集める。
 *
 * **どの失敗でも例外を投げない。** 解決できない、manifestが不正、版域外、
 * `activate`が投げる、のいずれも診断になり、そのプラグインの貢献点だけが
 * 無いものとして扱われる。repositoryの読み込み、validate、build、serverの
 * 起動を、プラグインが原因で失敗させない。
 */
export async function loadPlugins(
  options: LoadPluginsOptions
): Promise<PluginRegistry> {
  const registry: PluginRegistry = {
    plugins: [],
    kinds: new Map(),
    diagnostics: []
  };
  const seenIds = new Set<string>();

  // 解決はconfigDir起点。CLI自身のnode_modulesへは降りない。`vellym`はnpxでも
  // 実行されるため、CLI側の依存を拾うと利用者のプロジェクトに入っていないものが動く。
  const require = createRequire(path.join(path.resolve(options.configDir), "noop.js"));

  for (const [index, packageName] of options.packageNames.entries()) {
    const loaded = await loadOne(require, packageName, index, options.hostVersion, registry);
    if (!loaded) continue;
    if (seenIds.has(loaded.id)) {
      registry.diagnostics.push(
        diagnostic(
          index,
          "PLUGIN_DUPLICATE_ID",
          `plugin id "${loaded.id}"が重複しています: ${packageName}`
        )
      );
      continue;
    }
    seenIds.add(loaded.id);
    registry.plugins.push(loaded);
    for (const contribution of loaded.kinds) {
      const owner = registry.kinds.get(contribution.kind);
      if (owner) {
        registry.diagnostics.push(
          diagnostic(
            index,
            "PLUGIN_KIND_CONFLICT",
            `kind "${contribution.kind}"は${owner.packageName}が既に解釈します。${packageName}の登録は無視します`
          )
        );
        continue;
      }
      registry.kinds.set(contribution.kind, loaded);
    }
  }
  return registry;
}

/**
 * プラグインの`package.json`を見つける。
 *
 * `require.resolve(name + "/package.json")`は使えない。`exports`を持つ
 * パッケージは`./package.json`を公開しない仕様であり、公開しているのは
 * 例外的な方である。node_modulesの探索path上を直接見る。
 */
function findPackageJson(require: NodeRequire, packageName: string): string | undefined {
  const segments = packageName.split("/");
  for (const base of require.resolve.paths(packageName) ?? []) {
    const candidate = path.join(base, ...segments, "package.json");
    if (existsSync(candidate)) return candidate;
  }
  // symlinkやhoistで探索pathから外れる配置のために、entryから上へ辿る。
  let directory = path.dirname(require.resolve(packageName));
  for (;;) {
    const candidate = path.join(directory, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function loadOne(
  require: NodeRequire,
  packageName: string,
  index: number,
  hostVersion: string,
  registry: PluginRegistry
): Promise<LoadedPlugin | undefined> {
  let packageJsonPath: string;
  let packageJson: Record<string, unknown>;
  try {
    const found = findPackageJson(require, packageName);
    if (!found) throw new Error(`package.jsonが見つかりません: ${packageName}`);
    packageJsonPath = found;
    packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    registry.diagnostics.push(
      diagnostic(
        index,
        "PLUGIN_RESOLVE_FAILED",
        `プラグインを解決できません: ${packageName}（${reason(error)}）`
      )
    );
    return undefined;
  }

  const validated = validatePluginManifest(packageJson[PLUGIN_MANIFEST_FIELD]);
  if (!validated.manifest) {
    registry.diagnostics.push(
      diagnostic(
        index,
        "PLUGIN_MANIFEST_INVALID",
        `manifest（package.jsonの"${PLUGIN_MANIFEST_FIELD}"）が不正です: ${packageName}（${validated.errors.join("、")}）`
      )
    );
    return undefined;
  }

  const engines = packageJson.engines as { vellym?: string } | undefined;
  const range = engines?.vellym;
  if (range === undefined) {
    registry.diagnostics.push(
      diagnostic(
        index,
        "PLUGIN_VERSION_UNDECLARED",
        `engines.vellymが宣言されていません: ${packageName}`
      )
    );
    return undefined;
  }
  // includePrereleaseを付けないと、host版がbetaである間はすべての版域が外れる。
  if (!satisfies(hostVersion, range, { includePrerelease: true })) {
    registry.diagnostics.push(
      diagnostic(
        index,
        "PLUGIN_VERSION_UNSUPPORTED",
        `対応するVellymの版域外です: ${packageName}（engines.vellym: ${range}、実行中: ${hostVersion}）`
      )
    );
    return undefined;
  }

  let module: VellymPluginModule;
  try {
    const entry = require.resolve(packageName, { paths: [path.dirname(packageJsonPath)] });
    const imported = (await import(pathToFileURL(entry).href)) as
      | VellymPluginModule
      | { default?: VellymPluginModule };
    const candidate =
      typeof (imported as VellymPluginModule).activate === "function"
        ? (imported as VellymPluginModule)
        : (imported as { default?: VellymPluginModule }).default;
    if (!candidate || typeof candidate.activate !== "function") {
      registry.diagnostics.push(
        diagnostic(
          index,
          "PLUGIN_ENTRY_INVALID",
          `activate(host)をexportしていません: ${packageName}`
        )
      );
      return undefined;
    }
    module = candidate;
  } catch (error) {
    registry.diagnostics.push(
      diagnostic(
        index,
        "PLUGIN_LOAD_FAILED",
        `読み込めません: ${packageName}（${reason(error)}）`
      )
    );
    return undefined;
  }

  // ブラウザ側の資産。`exports["./browser"]`を宣言したプラグインだけが持つ。
  // **解決はパッケージ自身のexportsに任せる。** hostがpathを組み立てて
  // 決め打ちすると、パッケージの構成を外から縛ることになる。
  const browser = resolveBrowserEntry(require, packageName);

  const plugin: LoadedPlugin = {
    packageName,
    id: validated.manifest.id,
    ...(typeof packageJson.version === "string" ? { version: packageJson.version } : {}),
    manifest: validated.manifest,
    ...(browser ? { browserRoot: browser.root, browserEntry: browser.entry } : {}),
    kinds: [],
    views: [],
    commands: [],
    projections: new Map()
  };

  const host: VellymPluginHost = {
    pluginId: plugin.id,
    hostVersion,
    registerKind: (contribution) => plugin.kinds.push(contribution),
    registerView: (contribution) => plugin.views.push(contribution),
    registerCommand: (contribution) => plugin.commands.push(contribution),
    registerRecordProjection: (kind, project) => plugin.projections.set(kind, project),
    reportDiagnostic: (item) => registry.diagnostics.push({ ...item })
  };

  try {
    await module.activate(host);
  } catch (error) {
    registry.diagnostics.push(
      diagnostic(
        index,
        "PLUGIN_ACTIVATE_FAILED",
        `activateが失敗しました: ${packageName}（${reason(error)}）`
      )
    );
    return undefined;
  }
  return plugin;
}

/** 索引行に載る値。プラグインが返したものをそのまま使う */
export type PluginIndexRow = Readonly<
  Record<string, string | number | boolean | null | readonly string[]>
>;

export interface PluginViewRow {
  name: string;
  title: string;
  relativePath: string;
  values: PluginIndexRow;
  /** この行についての注意の件数。0なら印を出さない。値は読めていて編集もできる */
  noticeCount?: number;
  /** この行についての読み込みの失敗の件数。注意と同じ見た目にしない */
  errorCount?: number;
}

export interface PluginViewPayload {
  pluginId: string;
  viewId: string;
  descriptor: PluginViewDescriptor;
  rows: PluginViewRow[];
  /**
   * 既定の絞り込みのうち、descriptorの`kind`に属するものすべて。
   * 「完了を含める」のような切替を、再取得なしで行えるようにする。
   */
  allRows: PluginViewRow[];
  /** 詳細で編集する対象の現在値。索引行そのものを渡す */
  target?: PluginViewRow;
  /** 繰り返し構造のように、索引行では表せない現在値を編集するための`spec` */
  targetSpec?: Readonly<Record<string, unknown>>;
  /** 開いているリソースについての注意。定義との食い違いをその場で見せる */
  targetDiagnostics?: PluginDiagnostic[];
  /** 同じkindに登録された他のビュー。画面の切り替えに使う */
  siblings?: Array<{ id: string; type: "list" | "detail"; label?: PluginLocalizedText }>;
  /** このビューから起こせるコマンド。静的出力では使えないものを除く */
  commands: Array<{
    id: string;
    title: PluginLocalizedText;
    inputs?: readonly PluginCommandInput[];
  }>;
}

/**
 * コマンドの入力欄を解決する。
 *
 * 対象によって尋ねることが変わる場合があるため、宣言は関数でもよい。
 * プラグインが投げてもSPAを壊さない。尋ねずに実行できる形へ落とす。
 */
export function resolveCommandInputs(
  command: PluginCommandContribution,
  context: PluginViewContext
): readonly PluginCommandInput[] | undefined {
  if (!command.inputs) return undefined;
  try {
    const inputs =
      typeof command.inputs === "function" ? command.inputs(context) : command.inputs;
    return inputs.length ? inputs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 指定kindのリソースを開いたときに表示するビュー。
 *
 * 同じkindに複数のビューを登録できる（一覧と設定など）。`viewId`を指定すると
 * そのビューを選び、省略すると最初に登録されたものを使う。
 */
export function viewForKind(
  registry: PluginRegistry,
  kind: string,
  viewId?: string
): { plugin: LoadedPlugin; contribution: PluginViewContribution } | undefined {
  for (const plugin of registry.plugins) {
    for (const contribution of plugin.views) {
      const descriptorKind =
        typeof contribution.view === "function" ? undefined : contribution.view.kind;
      const opensKind = contribution.opensKind ?? descriptorKind;
      if (opensKind !== kind) continue;
      if (viewId && contribution.id !== viewId) continue;
      return { plugin, contribution };
    }
  }
  return undefined;
}

/**
 * 索引行1件が絞り込みを満たすか。
 *
 * 一覧の既定の絞り込みだけをここで適用する。利用者が画面で変えた条件は
 * 個人設定であり、正本にもこの経路にも持ち込まない。
 */
function matchesFilter(row: PluginIndexRow, filter: PluginFilterDescriptor): boolean {
  const value = row[filter.columnId];
  switch (filter.operator) {
    case "equals":
      return value === filter.value;
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(String(value ?? ""));
    case "not-in":
      return !(Array.isArray(filter.value) && filter.value.includes(String(value ?? "")));
    case "contains":
      return Array.isArray(value)
        ? value.includes(String(filter.value ?? ""))
        : String(value ?? "").includes(String(filter.value ?? ""));
    case "exists":
      return value !== undefined && value !== null && value !== "";
    default:
      return true;
  }
}

/**
 * 開いたリソースに対応するビューと、その行を組み立てる。
 *
 * 行は索引行から作る。完全なリソースは読み直さない。ビューが無い、または
 * descriptorの組み立てが失敗した場合は`undefined`を返し、通常の表示へ委ねる。
 */
export function buildPluginView(options: {
  registry: PluginRegistry;
  /** 開いたリソース */
  target: PluginResourceRecord;
  /** 索引行を持つ候補。kindで絞る前の全件でよい */
  rows: readonly PluginViewRow[];
  /** 詳細で編集する対象の索引行 */
  targetRow?: PluginViewRow;
  /** 開いているリソースについての注意 */
  targetDiagnostics?: readonly PluginDiagnostic[];
  definitions(kind: string): readonly PluginResourceRecord[];
  locale: string;
  isStatic: boolean;
  /** 同じkindに複数のビューがある場合に、どれを出すか */
  viewId?: string;
}): PluginViewPayload | undefined {
  const found = viewForKind(options.registry, options.target.kind, options.viewId);
  if (!found) return undefined;
  const { plugin, contribution } = found;
  const context: PluginViewContext = {
    locale: options.locale,
    isStatic: options.isStatic,
    target: options.target,
    records: options.definitions
  };
  let descriptor: PluginViewDescriptor;
  try {
    descriptor =
      typeof contribution.view === "function"
        ? contribution.view(context)
        : contribution.view;
  } catch {
    // プラグインが投げてもSPAを壊さない。ビューが無いものとして扱う。
    return undefined;
  }
  // 一覧の同一性に関わる絞り込みは常に効かせる。初期表示の絞り込みは、
  // 切替で外せるように分けて持つ。
  /*
   * 一覧の同一性に関わる絞り込みは常に効かせる。
   *
   * **詳細のビューでも索引行を渡す。** プラグインが自分で描く画面では、
   * 「このステータスを使っているチケットが3件あります」を出すために
   * 数え上げの材料が要る（受入C03）。ここを一覧だけにしていたため、
   * 定義編集の画面で件数が常に0になっていた。
   *
   * 渡すのは索引行であって`spec`ではない。数えるのに本文は要らない。
   */
  const scoped =
    descriptor.type === "list"
      ? options.rows.filter((row) =>
          (descriptor.scopeFilters ?? []).every((filter) => matchesFilter(row.values, filter))
        )
      : [...options.rows];
  const rows =
    descriptor.type === "list"
      ? scoped.filter((row) =>
          (descriptor.defaultFilters ?? []).every((filter) => matchesFilter(row.values, filter))
        )
      : [];
  return {
    pluginId: plugin.id,
    viewId: contribution.id,
    descriptor,
    rows,
    allRows: scoped,
    siblings: plugin.views
      .filter((item) => {
        const itemKind =
          typeof item.view === "function" ? undefined : item.view.kind;
        return (item.opensKind ?? itemKind) === options.target.kind;
      })
      .map((item) => ({
        id: item.id,
        // descriptorは関数の場合があり、呼ばずに種別を知る必要がある。
        // manifestが宣言した種別を使う。宣言と実装の一致はプラグイン側の責務。
        type:
          plugin.manifest.contributes?.views?.find((declared) => declared.id === item.id)
            ?.type ?? "list",
        ...(item.label ? { label: item.label } : {})
      })),
    commands: plugin.commands
      .filter((command) => command.placement !== "document-tree")
      .filter((command) => !options.isStatic || command.static)
      .map((command) => {
        const inputs = resolveCommandInputs(command, context);
        return {
          id: command.id,
          title: command.title,
          ...(inputs ? { inputs } : {})
        };
      }),
    ...(descriptor.type === "detail" && options.targetRow
      ? { target: options.targetRow }
      : {}),
    // 繰り返し構造は索引行では表せない。詳細のときだけ`spec`を渡す。
    ...(descriptor.type === "detail" ? { targetSpec: options.target.spec } : {}),
    ...(descriptor.type === "detail" && options.targetDiagnostics?.length
      ? { targetDiagnostics: [...options.targetDiagnostics] }
      : {})
  };
}

/**
 * repositoryのsnapshotから、開いた資源のビューを組み立てる。
 *
 * **devサーバと静的生成で同じ経路を通すためにある。** 索引行の集め方、
 * 注意と失敗の分け方、定義レコードの渡し方が2箇所に分かれると、
 * 静的版だけ挙動が違うという状態が生まれる。
 *
 * 違うのは`isStatic`と`locale`だけである。編集ができないことは`isStatic`の
 * 宣言でプラグイン側が落とし、hostが操作を`disabled`で残すことはしない。
 */
export function buildPluginViewFromSnapshot(options: {
  registry: PluginRegistry | undefined;
  snapshot: {
    pages: readonly {
      kind: string;
      name: string;
      title: string;
      relativePath: string;
      readOnly: boolean;
      indexRow?: Readonly<Record<string, PluginIndexValue>>;
    }[];
    diagnostics: readonly Diagnostic[];
    definitionRecords?: readonly PluginResourceRecord[];
  };
  /** 開いた資源の`metadata.name` */
  name: string;
  locale: string;
  isStatic: boolean;
  viewId?: string;
}): PluginViewPayload | undefined {
  const { registry, snapshot } = options;
  if (!registry) return undefined;
  const entry = snapshot.pages.find((page) => page.name === options.name);
  if (!entry) return undefined;

  // プラグインが出した注意は、その資源の画面で見せる。全体の警告に紛れさせない。
  const noticesByFile = new Map<string, Diagnostic[]>();
  for (const item of snapshot.diagnostics) {
    const list = noticesByFile.get(item.file) ?? [];
    list.push(item);
    noticesByFile.set(item.file, list);
  }

  const rows: PluginViewRow[] = [];
  for (const candidate of snapshot.pages) {
    if (!candidate.indexRow) continue;
    const found = noticesByFile.get(candidate.relativePath) ?? [];
    // 注意と読み込みの失敗を分けて渡す。前者は値が読めていて編集もできる。
    // 一覧で同じ見た目にすると、直すべきものが埋もれる。
    const errors = found.filter((item) => item.severity === "error").length;
    const notices = found.length - errors;
    rows.push({
      name: candidate.name,
      title: candidate.title,
      relativePath: candidate.relativePath,
      values: candidate.indexRow,
      ...(notices ? { noticeCount: notices } : {}),
      ...(errors ? { errorCount: errors } : {})
    });
  }

  const definitions = snapshot.definitionRecords ?? [];
  // 定義リソースはspecごと保持している。索引行しか持たないものは、
  // 位置と識別子だけの軽いレコードとして渡す。
  const target = definitions.find((record) => record.name === entry.name) ?? {
    kind: entry.kind,
    name: entry.name,
    title: entry.title,
    relativePath: entry.relativePath,
    spec: {},
    readOnly: entry.readOnly
  };
  const targetNotices = noticesByFile.get(entry.relativePath) ?? [];
  return buildPluginView({
    registry,
    target,
    rows,
    ...(targetNotices.length ? { targetDiagnostics: targetNotices } : {}),
    ...(entry.indexRow
      ? {
          targetRow: {
            name: entry.name,
            title: entry.title,
            relativePath: entry.relativePath,
            values: entry.indexRow
          }
        }
      : {}),
    definitions: (kind) => definitions.filter((record) => record.kind === kind),
    locale: options.locale,
    isStatic: options.isStatic,
    ...(options.viewId ? { viewId: options.viewId } : {})
  });
}
