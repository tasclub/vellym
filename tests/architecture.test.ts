import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

function sourceText(packageName: string, exclude: readonly string[] = []): string {
  const sourceRoot = path.join(workspaceRoot, "packages", packageName, "src");
  return readdirSync(sourceRoot)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .filter((name) => !exclude.includes(name))
    .sort()
    .map((name) => readFileSync(path.join(sourceRoot, name), "utf8"))
    .join("\n");
}

function packageJson(packageName: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  exports?: Record<string, unknown>;
  private?: boolean;
  publishConfig?: { access?: string };
} {
  return JSON.parse(
    readFileSync(
      path.join(workspaceRoot, "packages", packageName, "package.json"),
      "utf8"
    )
  );
}

describe("package boundaries", () => {
  it("keeps the public plugin contract independent from every implementation", () => {
    // 契約がCoreへ依存すると、内部実装が公開契約に変わる。向きはCore→契約だけ。
    // react.ts だけは例外なので別のテストで見る。
    const source = sourceText("plugin-api", ["react.ts"]);
    expect(source).not.toMatch(/@vellym-internal\/(core|runtime-node|ui-react)/);
    expect(source).not.toMatch(/from ["'](?:node:|react)/);
    const manifest = packageJson("plugin-api");
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    // 公開パッケージであること。scoped packageは既定が非公開なので明示が要る。
    expect(manifest.private).toBeUndefined();
    expect(manifest.publishConfig?.access).toBe("public");
  });

  it("confines React to the /react subpath of the contract", () => {
    // 描画契約はmountであり、Reactを必須にしない。Reactを使う作者のための
    // reactRendererは`@vellym/plugin-api/react`だけに置き、既定のエントリからは
    // 到達できないようにする。ここが崩れると、Vanillaで書くプラグインまで
    // Reactを要求されることになる。
    const manifest = packageJson("plugin-api");
    expect(manifest.exports?.["./react"]).toBeDefined();
    // 依存ではなくoptionalなpeerである。使わないプラグインへは入らない。
    expect(manifest.peerDependencies).toEqual({ react: ">=18", "react-dom": ">=18" });
    expect(manifest.peerDependenciesMeta?.react?.optional).toBe(true);
    expect(manifest.peerDependenciesMeta?.["react-dom"]?.optional).toBe(true);

    const sourceRoot = path.join(workspaceRoot, "packages", "plugin-api", "src");
    const reactSource = readFileSync(path.join(sourceRoot, "react.ts"), "utf8");
    // react.ts からしか react を読まない。逆に他のファイルが react.ts を
    // importすると既定のエントリへ引き込まれるので、そちらも禁じる。
    expect(reactSource).toMatch(/from "react"/);
    expect(sourceText("plugin-api", ["react.ts"])).not.toMatch(/\.\/react\.js/);
  });

  it("keeps the official plugin on the public contract only", () => {
    // 公式プラグインが内部モジュールを使えてしまうと、契約が痩せているかを
    // 確認できない。第三者と同じ条件で書く。
    const source = sourceText("plugin-tickets");
    expect(source).not.toMatch(/@vellym-internal\//);
    expect(source).not.toMatch(/from ["']node:/);
    expect(packageJson("plugin-tickets").dependencies).toBeUndefined();
  });

  it("keeps core independent from UI, runtime, CLI, and Node.js", () => {
    const source = sourceText("core");
    expect(source).not.toMatch(/@vellym-internal\/(runtime-node|ui-react)/);
    expect(source).not.toMatch(/from ["'](?:node:|react)/);
    expect(packageJson("core").dependencies).toEqual({
      // 公開契約はCoreが実装する側なので、依存の向きはこちらだけ。
      "@vellym/plugin-api": "*",
      ajv: "^8.17.1",
      "ajv-formats": "^3.0.1",
      "mdast-util-from-markdown": "^2.0.3",
      "mdast-util-to-string": "^4.0.0"
    });
  });

  it("allows runtime-node to depend on core but not UI or CLI", () => {
    const source = sourceText("runtime-node");
    expect(source).not.toMatch(/@vellym-internal\/ui-react/);
    expect(source).not.toMatch(/from ["']react/);
    expect(packageJson("runtime-node").dependencies).toMatchObject({
      "@vellym-internal/core": "*"
    });
  });

  it("keeps ui-react independent from the Node.js runtime and CLI", () => {
    const source = sourceText("ui-react");
    const dependencies = packageJson("ui-react").dependencies;
    expect(source).not.toMatch(/@vellym-internal\/runtime-node/);
    expect(source).not.toMatch(/from ["']node:/);
    expect(dependencies).toMatchObject({
      "@vellym-internal/core": "*"
    });
    expect(dependencies).toMatchObject({
      "@milkdown/core": "^7.21.3",
      "@milkdown/plugin-history": "^7.21.3",
      "@milkdown/plugin-listener": "^7.21.3",
      "@milkdown/prose": "^7.21.3",
      "@milkdown/preset-commonmark": "^7.21.3"
    });
    expect(dependencies).not.toHaveProperty("@milkdown/kit");
    expect(dependencies).not.toHaveProperty("@milkdown/crepe");
    expect(dependencies).not.toHaveProperty("@milkdown/react");
    expect(source).not.toMatch(/@milkdown\/(?:kit|crepe|react)/);
  });
});
