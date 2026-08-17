import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadPlugins,
  loadRepository,
  localizedPageSummaries,
  parsePagePatch,
  savePage,
  unknownKindGroups
} from "@vellym-internal/runtime-node";

const HOST_VERSION = "0.3.0-beta.1";

interface FakePlugin {
  name: string;
  engines?: string;
  manifest?: unknown;
  entry?: string;
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
      ...(plugin.useExports
        ? { exports: { ".": "./index.mjs" } }
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
}

async function projectWith(plugins: FakePlugin[]): Promise<string> {
  const configDir = await mkdtemp(path.join(tmpdir(), "vellym-plugins-"));
  for (const plugin of plugins) await installPlugin(configDir, plugin);
  return configDir;
}

const ticketManifest = { id: "tickets", contributes: { kinds: [{ kind: "Ticket" }] } };

describe("loadPlugins", () => {
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

  it("refuses to write through the fields path into core-owned parts of spec", () => {
    for (const key of ["blocks", "locale", "translations"]) {
      expect(() =>
        parsePagePatch({ baseHash: "x".repeat(64), specValues: [{ path: [key], value: "x" }] })
      ).toThrow();
    }
  });
});
