import { mkdir, mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPluginView,
  loadPlugins,
  loadRepository,
  localizedPageSummaries,
  parsePagePatch,
  pluginKinds,
  savePage,
  startDevServer,
  unknownKindGroups
} from "@vellym-internal/runtime-node";

const HOST_VERSION = "0.3.0-beta.1";

interface FakePlugin {
  name: string;
  engines?: string;
  manifest?: unknown;
  entry?: string;
  browser?: boolean;
  /** `exports`を持つ実際の公開パッケージの形にする */
  useExports?: boolean;
}

/** configDirの`node_modules`へプラグインを1つ置く */
async function installPlugin(configDir: string, plugin: FakePlugin): Promise<void> {
  const directory = path.join(configDir, "node_modules", ...plugin.name.split("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: plugin.name,
      version: "1.0.0",
      type: "module",
      // exportsを持つパッケージは"./package.json"を公開しない。hostはそれでも
      // manifestへ辿り着けなければならない。
      ...(plugin.useExports || plugin.browser
        ? { exports: {
            ".": "./index.mjs",
            ...(plugin.browser ? { "./browser": "./browser/index.js" } : {})
          } }
        : { main: "index.mjs" }),
      ...(plugin.engines === undefined ? {} : { engines: { vellym: plugin.engines } }),
      ...(plugin.manifest === undefined ? {} : { vellym: plugin.manifest })
    })
  );
  await writeFile(
    path.join(directory, "index.mjs"),
    plugin.entry ??
      `export function activate(host) { host.registerKind({ kind: "Ticket" }); }`
  );
  if (plugin.browser) {
    await mkdir(path.join(directory, "browser"), { recursive: true });
    await writeFile(path.join(directory, "browser/index.js"), "export default { activate() {} };\n");
  }
}

async function projectWith(plugins: FakePlugin[]): Promise<string> {
  const configDir = await mkdtemp(path.join(tmpdir(), "vellym-plugins-"));
  for (const plugin of plugins) await installPlugin(configDir, plugin);
  return configDir;
}

const ticketManifest = { id: "tickets", contributes: { kinds: [{ kind: "Ticket" }] } };

describe("loadPlugins", () => {
  it("serves only real files inside the browser asset directory", async () => {
    const dir = await projectWith([{ name: "safe-plugin", engines: ">=0.3.0-beta.1", manifest: { id: "safe-plugin" }, browser: true }]);
    const browser = path.join(dir, "node_modules/safe-plugin/browser");
    await mkdir(path.join(dir, "content"));
    await writeFile(path.join(dir, "secret.js"), "secret");
    await symlink(path.join(dir, "secret.js"), path.join(browser, "link.js"));
    await symlink(dir, path.join(browser, "outside"));
    const configPath = path.join(dir, "vellym.config.yaml");
    await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins:\n  - safe-plugin\n');
    const server = await startDevServer({ configPath, uiRoot: dir, port: 0, hostVersion: HOST_VERSION });
    try {
      expect((await fetch(`${server.url}/plugins/safe-plugin/index.js`)).status).toBe(200);
      for (const file of ["link.js", "outside/secret.js", "%2e%2e%2fsecret.js", "%2fsecret.js"]) {
        expect((await fetch(`${server.url}/plugins/safe-plugin/${file}`)).status).toBe(404);
      }
    } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it("activates a plugin resolved from the project directory", async () => {
    const configDir = await projectWith([
      { name: "vellym-plugin-tickets", engines: ">=0.3.0-beta.1", manifest: ticketManifest }
    ]);
    const registry = await loadPlugins({
      configDir,
      packageNames: ["vellym-plugin-tickets"],
      hostVersion: HOST_VERSION
    });
    expect(registry.diagnostics).toEqual([]);
    expect(registry.plugins.map((plugin) => plugin.id)).toEqual(["tickets"]);
    expect(registry.kinds.get("Ticket")?.packageName).toBe("vellym-plugin-tickets");
  });

  it("turns every failure into a diagnostic instead of throwing", async () => {
    const configDir = await projectWith([
      // 版域外。host版がprereleaseでも範囲判定が働くこと。
      { name: "out-of-range", engines: ">=9.0.0", manifest: ticketManifest },
      { name: "no-manifest", engines: ">=0.3.0-beta.1" },
      {
        name: "throws",
        engines: ">=0.3.0-beta.1",
        manifest: { id: "throws" },
        entry: `export function activate() { throw new Error("boom"); }`
      }
    ]);
    const registry = await loadPlugins({
      configDir,
      packageNames: ["missing-package", "out-of-range", "no-manifest", "throws"],
      hostVersion: HOST_VERSION
    });
    expect(registry.plugins).toEqual([]);
    expect(registry.diagnostics.map((item) => item.code)).toEqual([
      "PLUGIN_RESOLVE_FAILED",
      "PLUGIN_VERSION_UNSUPPORTED",
      "PLUGIN_MANIFEST_INVALID",
      "PLUGIN_ACTIVATE_FAILED"
    ]);
    expect(registry.diagnostics.every((item) => item.severity === "warning")).toBe(true);
  });

  it("finds the manifest of a package that only exports its entry", async () => {
    const configDir = await projectWith([
      {
        name: "@scope/exports-only",
        engines: ">=0.3.0-beta.1",
        manifest: ticketManifest,
        useExports: true
      }
    ]);
    const registry = await loadPlugins({
      configDir,
      packageNames: ["@scope/exports-only"],
      hostVersion: HOST_VERSION
    });
    expect(registry.diagnostics).toEqual([]);
    expect(registry.plugins.map((plugin) => plugin.id)).toEqual(["tickets"]);
  });

  it("resolves stylesheet declarations relative to the exported browser directory", async () => {
    const configDir = await projectWith([{
      name: "@scope/styled",
      engines: ">=0.3.0-beta.1",
      manifest: { id: "styled", styles: ["styled.css"] },
      browser: true
    }]);
    const registry = await loadPlugins({
      configDir,
      packageNames: ["@scope/styled"],
      hostVersion: HOST_VERSION
    });
    expect(registry.diagnostics).toEqual([]);
    expect(registry.plugins[0]).toMatchObject({
      browserEntry: "index.js",
      browserStyles: ["styled.css"]
    });
  });

  it("keeps the first plugin that claims a kind", async () => {
    const configDir = await projectWith([
      { name: "first", engines: ">=0.3.0-beta.1", manifest: ticketManifest },
      {
        name: "second",
        engines: ">=0.3.0-beta.1",
        manifest: { id: "other", contributes: { kinds: [{ kind: "Ticket" }] } }
      }
    ]);
    const registry = await loadPlugins({
      configDir,
      packageNames: ["first", "second"],
      hostVersion: HOST_VERSION
    });
    expect(registry.kinds.get("Ticket")?.packageName).toBe("first");
    expect(registry.diagnostics.map((item) => item.code)).toEqual(["PLUGIN_KIND_CONFLICT"]);
  });

  it("resolves duplicate kinds by declared semver independent of plugin order", async () => {
    const first = {
      name: "engine-old",
      engines: ">=0.3.0-beta.1",
      manifest: { id: "engine-old", contributes: { kinds: [{ kind: "Ticket" }] } },
      entry: `export function activate(host) { host.registerKind({ kind: "Ticket", engineVersion: "1.2.0-beta.2" }); }`
    };
    const second = {
      name: "engine-new",
      engines: ">=0.3.0-beta.1",
      manifest: { id: "engine-new", contributes: { kinds: [{ kind: "Ticket" }] } },
      entry: `export function activate(host) { host.registerKind({ kind: "Ticket", engineVersion: "1.2.0" }); }`
    };
    for (const plugins of [[first, second], [second, first]]) {
      const configDir = await projectWith(plugins);
      const registry = await loadPlugins({
        configDir,
        packageNames: plugins.map((plugin) => plugin.name),
        hostVersion: HOST_VERSION
      });
      expect(registry.kinds.get("Ticket")?.id).toBe("engine-new");
      expect(registry.diagnostics.map((item) => item.code)).toEqual([
        "PLUGIN_KIND_VERSION_MISMATCH"
      ]);
    }
  });

  it("does not warn when duplicate kind registrations declare the same version", async () => {
    const plugins = ["engine-a", "engine-b"].map((name) => ({
      name,
      engines: ">=0.3.0-beta.1",
      manifest: { id: name, contributes: { kinds: [{ kind: "Ticket" }] } },
      entry: `export function activate(host) { host.registerKind({ kind: "Ticket", engineVersion: "1.2.0" }); }`
    }));
    const configDir = await projectWith(plugins);
    const registry = await loadPlugins({
      configDir,
      packageNames: plugins.map((plugin) => plugin.name),
      hostVersion: HOST_VERSION
    });
    expect(registry.kinds.get("Ticket")?.id).toBe("engine-a");
    expect(registry.diagnostics).toEqual([]);
  });
});

describe("plugin view siblings", () => {
  it("includes labeled views from other plugins and filters by static availability", async () => {
    const listDescriptor = (id: string) => ({
      type: "list",
      id,
      kind: "Ticket",
      title: { en: id },
      columns: []
    });
    const plugins: FakePlugin[] = [
      {
        name: "views-one",
        engines: ">=0.3.0-beta.1",
        manifest: {
          id: "views-one",
          contributes: {
            views: [
              { id: "tracker-list", kind: "TicketTracker", type: "list", static: true },
              { id: "hidden-label", kind: "TicketTracker", type: "list", static: true },
              { id: "dynamic", kind: "TicketTracker", type: "list", static: false }
            ]
          }
        },
        entry: `export function activate(host) {
          host.registerView({ id: "tracker-list", opensKind: "TicketTracker", label: { en: "List" }, static: true, view: ${JSON.stringify(listDescriptor("tracker-list"))} });
          host.registerView({ id: "hidden-label", opensKind: "TicketTracker", static: true, view: ${JSON.stringify(listDescriptor("hidden-label"))} });
          host.registerView({ id: "dynamic", opensKind: "TicketTracker", label: { en: "Dynamic" }, static: false, view: ${JSON.stringify(listDescriptor("dynamic"))} });
        }`
      },
      {
        name: "views-two",
        engines: ">=0.3.0-beta.1",
        manifest: {
          id: "views-two",
          contributes: {
            views: [
              { id: "board", kind: "TicketTracker", type: "detail", static: true }
            ]
          }
        },
        entry: `export function activate(host) {
          host.registerView({ id: "board", opensKind: "TicketTracker", label: { en: "Board" }, static: true, view: ${JSON.stringify(listDescriptor("board"))} });
        }`
      }
    ];
    const configDir = await projectWith(plugins);
    const registry = await loadPlugins({
      configDir,
      packageNames: plugins.map((plugin) => plugin.name),
      hostVersion: HOST_VERSION
    });
    const payload = (isStatic: boolean) =>
      buildPluginView({
        registry,
        target: {
          kind: "TicketTracker",
          name: "tracker-1",
          title: "Tracker",
          relativePath: "tracker.yaml",
          spec: {},
          readOnly: true
        },
        rows: [],
        definitions: () => [],
        locale: "en",
        isStatic
      });

    const devPayload = payload(false)!;
    const staticPayload = payload(true)!;
    expect(devPayload.siblings!.map((item) => item.id)).toEqual([
      "tracker-list",
      "dynamic",
      "board"
    ]);
    expect(devPayload.siblings![2]?.type).toBe("detail");
    expect(staticPayload.siblings!.map((item) => item.id)).toEqual(["tracker-list", "board"]);
  });
});

describe("known kinds from plugins", () => {
  /** Ticketを1件だけ置いたcontent rootを作る */
  async function contentRootWithTicket(): Promise<string> {
    const contentRoot = await mkdtemp(path.join(tmpdir(), "vellym-kinds-"));
    await writeFile(
      path.join(contentRoot, "ticket-01.yaml"),
      [
        "apiVersion: vellym.tasclub.com/v1",
        "kind: Ticket",
        "metadata:",
        "  name: ticket-01",
        "  title: 言語切り替えを追加する",
        "spec:",
        "  status: in-progress",
        ""
      ].join("\n")
    );
    return contentRoot;
  }

  it("reads a plugin kind without warning, and warns again once the plugin is gone", async () => {
    const contentRoot = await contentRootWithTicket();

    const withPlugin = await loadRepository(contentRoot, undefined, {
      knownKinds: new Set(["Ticket"])
    });
    expect(withPlugin.diagnostics).toEqual([]);
    expect(withPlugin.pages).toHaveLength(1);

    // プラグインを外すと同じファイルが未知kindの扱いへ戻る。読めることは変わらない。
    const withoutPlugin = await loadRepository(contentRoot);
    expect(withoutPlugin.diagnostics.map((item) => item.code)).toEqual([
      "UNKNOWN_RESOURCE_KIND"
    ]);
    expect(withoutPlugin.diagnostics.every((item) => item.severity === "warning")).toBe(true);
    expect(withoutPlugin.pages).toHaveLength(1);
    expect(withoutPlugin.pages[0]?.title).toBe(withPlugin.pages[0]?.title);
  });

  it("re-reads entries when the set of known kinds changes", async () => {
    const contentRoot = await contentRootWithTicket();
    const first = await loadRepository(contentRoot);
    // mtimeもsizeも変わらないが、解釈が変わるので前回の結果を使い回せない。
    const second = await loadRepository(contentRoot, first, {
      knownKinds: new Set(["Ticket"])
    });
    expect(second.diagnostics).toEqual([]);
  });
});

describe("record projections", () => {
  /** trackerを1つと、その配下・配下外のチケットを置く */
  async function contentRootWithTracker(): Promise<string> {
    const contentRoot = await mkdtemp(path.join(tmpdir(), "vellym-projection-"));
    await mkdir(path.join(contentRoot, "tests", "_保留"), { recursive: true });
    const write = async (relativePath: string, lines: string[]) => {
      await writeFile(path.join(contentRoot, relativePath), `${lines.join("\n")}\n`);
    };
    await write("tests/tracker.yaml", [
      "apiVersion: vellym.tasclub.com/v1",
      "kind: Demo",
      "metadata:",
      "  name: demo-tracker",
      "  title: デモ",
      "spec:",
      "  label: 単体テスト"
    ]);
    await write("tests/item-01.yaml", [
      "apiVersion: vellym.tasclub.com/v1",
      "kind: DemoItem",
      "metadata:",
      "  name: item-01",
      "  title: 配下の項目",
      "spec:",
      "  status: open"
    ]);
    await write("tests/_保留/item-02.yaml", [
      "apiVersion: vellym.tasclub.com/v1",
      "kind: DemoItem",
      "metadata:",
      "  name: item-02",
      "  title: 対象外の項目",
      "spec:",
      "  status: open"
    ]);
    return contentRoot;
  }

  const options = {
    knownKinds: new Set(["Demo", "DemoItem"]),
    treeKinds: new Set(["Demo"]),
    projections: new Map([
      [
        "DemoItem",
        // 定義（projectorを登録していないkind）は、projectorを作る時点で読める。
        (context: { records(kind: string): readonly { spec: Record<string, unknown> }[] }) => {
          const label = context.records("Demo")[0]?.spec.label;
          return (record: { relativePath: string; spec: Record<string, unknown> }) =>
            record.relativePath.includes("/_")
              ? undefined
              : {
                  values: {
                    label: String(label ?? ""),
                    status: String(record.spec.status ?? "")
                  }
                };
        }
      ]
    ])
  } as unknown as Parameters<typeof loadRepository>[2];

  it("builds index rows from definitions that projectors can read", async () => {
    const contentRoot = await contentRootWithTracker();
    const snapshot = await loadRepository(contentRoot, undefined, options);
    const rows = new Map(snapshot.pages.map((entry) => [entry.name, entry.indexRow]));
    expect(rows.get("item-01")).toEqual({ label: "単体テスト", status: "open" });
    // projectorがundefinedを返したものは索引に載らない。警告も出ない。
    expect(rows.get("item-02")).toBeUndefined();
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("shows only the declared tree kind in the document tree", () => {
    return contentRootWithTracker().then(async (contentRoot) => {
      const snapshot = await loadRepository(contentRoot, undefined, options);
      const summaries = localizedPageSummaries(snapshot, "ja", "ja");
      expect(summaries.map((item) => item.name)).toEqual(["demo-tracker"]);
      // 解釈できるプラグインがあるkindは「未知の内容」に数えない。
      expect(unknownKindGroups(snapshot)).toEqual([]);
    });
  });

  it("re-reads everything when a definition changes", async () => {
    const contentRoot = await contentRootWithTracker();
    const first = await loadRepository(contentRoot, undefined, options);
    await writeFile(
      path.join(contentRoot, "tests", "tracker.yaml"),
      [
        "apiVersion: vellym.tasclub.com/v1",
        "kind: Demo",
        "metadata:",
        "  name: demo-tracker",
        "  title: デモ",
        "spec:",
        "  label: 結合テスト",
        ""
      ].join("\n")
    );
    const second = await loadRepository(contentRoot, first, options);
    // 定義が変わったので、変更していない項目の索引行も作り直される。
    const row = second.pages.find((entry) => entry.name === "item-01")?.indexRow;
    expect(row).toEqual({ label: "結合テスト", status: "open" });
  });
});

describe("record set validators", () => {
  /** 索引行が2件と、`_`始まりで索引に載らない行が1件ある領域 */
  async function contentRootWithItems(): Promise<string> {
    const contentRoot = await mkdtemp(path.join(tmpdir(), "vellym-validators-"));
    await mkdir(path.join(contentRoot, "tests", "_保留"), { recursive: true });
    const write = async (relativePath: string, lines: string[]) => {
      await writeFile(path.join(contentRoot, relativePath), `${lines.join("\n")}\n`);
    };
    await write("tests/tracker.yaml", [
      "apiVersion: vellym.tasclub.com/v1",
      "kind: Demo",
      "metadata:",
      "  name: demo-tracker",
      "  title: デモ"
    ]);
    for (const name of ["item-01", "item-02"]) {
      await write(`tests/${name}.yaml`, [
        "apiVersion: vellym.tasclub.com/v1",
        "kind: DemoItem",
        "metadata:",
        `  name: ${name}`,
        `  title: 項目 ${name}`,
        "spec:",
        "  status: open"
      ]);
    }
    await write("tests/_保留/item-03.yaml", [
      "apiVersion: vellym.tasclub.com/v1",
      "kind: DemoItem",
      "metadata:",
      "  name: item-03",
      "  title: 対象外の項目",
      "spec:",
      "  status: open"
    ]);
    return contentRoot;
  }

  const projectorFactory = () => (record: {
    relativePath: string;
    spec: Record<string, unknown>;
  }) =>
    record.relativePath.includes("/_")
      ? undefined
      : { values: { status: String(record.spec.status ?? "") } };

  it("runs once after the index rows are ready and keeps returned diagnostics", async () => {
    const contentRoot = await contentRootWithItems();
    let calls = 0;
    let seenNames: string[] = [];
    let seenStatuses: unknown[] = [];
    const validate = (rows: readonly { name: string; values: Record<string, unknown> }[]) => {
      calls += 1;
      seenNames = rows.map((row) => row.name).sort();
      seenStatuses = rows.map((row) => row.values.status);
      return [
        {
          file: rows[0]?.name ?? "",
          path: "/spec/status",
          severity: "warning" as const,
          code: "DEMO_SET_CHECK",
          message: { ja: "索引行の検査", en: "Index row check" }
        }
      ];
    };
    const snapshot = await loadRepository(contentRoot, undefined, {
      knownKinds: new Set(["Demo", "DemoItem"]),
      treeKinds: new Set(["Demo"]),
      projections: new Map([["DemoItem", projectorFactory]]),
      recordSetValidators: new Map([["DemoItem", [validate]]])
    } as unknown as Parameters<typeof loadRepository>[2]);
    expect(calls).toBe(1);
    // 索引に載らない行は渡らない。identity（name・title）と索引行の値が渡る。
    expect(seenNames).toEqual(["item-01", "item-02"]);
    expect(seenStatuses).toEqual(["open", "open"]);
    const warnings = snapshot.diagnostics.filter((item) => item.code === "DEMO_SET_CHECK");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ file: "item-01", severity: "warning" });
  });

  it("warns and keeps loading when a validator throws", async () => {
    const contentRoot = await contentRootWithItems();
    const snapshot = await loadRepository(contentRoot, undefined, {
      knownKinds: new Set(["Demo", "DemoItem"]),
      treeKinds: new Set(["Demo"]),
      projections: new Map([["DemoItem", projectorFactory]]),
      recordSetValidators: new Map([
        [
          "DemoItem",
          [
            () => {
              throw new Error("検査器が壊れた");
            }
          ]
        ]
      ])
    } as unknown as Parameters<typeof loadRepository>[2]);
    // 例外でも読み込みは続き、索引行は残る。
    const rows = snapshot.pages.filter((entry) => entry.kind === "DemoItem");
    expect(rows.filter((entry) => entry.indexRow).map((entry) => entry.name).sort())
      .toEqual(["item-01", "item-02"]);
    const warnings = snapshot.diagnostics.filter(
      (item) => item.code === "PLUGIN_RECORD_SET_VALIDATION_FAILED"
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ severity: "warning" });
  });

  it("reports the same diagnostic once when the same check runs twice", async () => {
    // 3つのプラグインが同じエンジンを別々に同梱した状態を模す。関数の参照は
    // 別だが返す診断は同じなので、file・path・codeで重複を除く。
    const contentRoot = await contentRootWithItems();
    const makeCopy = () => () => [
      {
        file: "item-01",
        path: "/spec/status",
        severity: "warning" as const,
        code: "DEMO_SHARED_CHECK",
        message: { ja: "共通の検査", en: "Shared check" }
      }
    ];
    const snapshot = await loadRepository(contentRoot, undefined, {
      knownKinds: new Set(["Demo", "DemoItem"]),
      treeKinds: new Set(["Demo"]),
      projections: new Map([["DemoItem", projectorFactory]]),
      recordSetValidators: new Map([["DemoItem", [makeCopy(), makeCopy(), makeCopy()]]])
    } as unknown as Parameters<typeof loadRepository>[2]);
    const warnings = snapshot.diagnostics.filter((item) => item.code === "DEMO_SHARED_CHECK");
    expect(warnings).toHaveLength(1);
  });

  it("runs a shared validator function once for the same kind", () => {
    // 同じエンジンを共有モジュールとして読み込んだプラグインは、同じ参照を
    // 登録する。kind別の集約時点で1本になる。
    const shared = () => [];
    const registry = {
      plugins: [
        { kinds: [], views: [], commands: [], projections: new Map(), recordSetValidators: new Map([["DemoItem", [shared, shared]]]) },
        { kinds: [], views: [], commands: [], projections: new Map(), recordSetValidators: new Map([["DemoItem", [shared]]]) }
      ],
      kinds: new Map(),
      diagnostics: []
    } as unknown as Parameters<typeof pluginKinds>[0];
    const kinds = pluginKinds(registry);
    expect(kinds.recordSetValidators.get("DemoItem")).toHaveLength(1);
  });
});

describe("saving a plugin kind", () => {
  it("writes declared fields while keeping comments and unknown keys", async () => {
    const contentRoot = await mkdtemp(path.join(tmpdir(), "vellym-save-"));
    const relativePath = "ticket-01.yaml";
    const source = [
      "apiVersion: vellym.tasclub.com/v1",
      "kind: Ticket",
      "metadata:",
      "  name: ticket-01",
      "  title: 保存に失敗する",
      "spec:",
      "  status: open",
      "  fields:",
      "    caseId: UT-014",
      "  # プラグインが解釈しない項目",
      "  vendorSpecific: keep-me",
      ""
    ].join("\n");
    await writeFile(path.join(contentRoot, relativePath), source);

    const snapshot = await loadRepository(contentRoot, undefined, {
      knownKinds: new Set(["Ticket"])
    });
    const loaded = snapshot.byName.get("ticket-01");
    expect(loaded).toBeDefined();

    await savePage(
      contentRoot,
      loaded!,
      parsePagePatch({
        baseHash: loaded!.hash,
        specValues: [
          { path: ["status"], value: "fixed" },
          { path: ["fields", "caseId"], value: "UT-099" }
        ]
      })
    );

    const saved = await readFile(path.join(contentRoot, relativePath), "utf8");
    expect(saved).toContain("status: fixed");
    expect(saved).toContain("caseId: UT-099");
    // 解釈しない項目とコメントは保存往復で失われない。
    expect(saved).toContain("vendorSpecific: keep-me");
    expect(saved).toContain("# プラグインが解釈しない項目");
  });

  it("saves design trees and enforces the spec value depth limit", async () => {
    const contentRoot = await mkdtemp(path.join(tmpdir(), "vellym-save-depth-"));
    const relativePath = "board.yaml";
    const source = [
      "apiVersion: vellym.tasclub.com/v1",
      "kind: Ticket",
      "metadata:",
      "  name: board-01",
      "  title: Design board",
      "spec:",
      "  status: open",
      ""
    ].join("\n");

    try {
      await writeFile(path.join(contentRoot, relativePath), source);
      const snapshot = await loadRepository(contentRoot, undefined, {
        knownKinds: new Set(["Ticket"])
      });
      const loaded = snapshot.byName.get("board-01");
      expect(loaded).toBeDefined();

      const root = { children: [{ fills: [{ color: "#123456" }] }] };
      await savePage(
        contentRoot,
        loaded!,
        parsePagePatch({
          baseHash: loaded!.hash,
          specValues: [{ path: ["root"], value: root }]
        })
      );
      const saved = await readFile(path.join(contentRoot, relativePath), "utf8");
      expect(saved).toContain('color: "#123456"');

      const nestedArray = (levels: number): unknown => {
        let value: unknown = null;
        for (let level = 0; level < levels; level += 1) value = [value];
        return value;
      };
      const patchFor = (value: unknown) => ({
        baseHash: "0".repeat(64),
        specValues: [{ path: ["root"], value }]
      });
      const expectBadRequest = (value: unknown) => {
        try {
          parsePagePatch(patchFor(value));
        } catch (error) {
          expect(error).toMatchObject({ status: 400 });
          return;
        }
        throw new Error("Expected an invalid spec value to return 400");
      };

      expect(() => parsePagePatch(patchFor(nestedArray(64)))).not.toThrow();
      expectBadRequest(nestedArray(65));
      expectBadRequest(() => undefined);
      expectBadRequest(Number.NaN);
    } finally {
      await rm(contentRoot, { recursive: true, force: true });
    }
  });

  it("refuses to write through the fields path into core-owned parts of spec", () => {
    for (const key of ["blocks", "locale", "translations"]) {
      expect(() =>
        parsePagePatch({ baseHash: "x".repeat(64), specValues: [{ path: [key], value: "x" }] })
      ).toThrow();
    }
  });
});
