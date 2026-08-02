import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

function sourceText(packageName: string): string {
  const sourceRoot = path.join(workspaceRoot, "packages", packageName, "src");
  return readdirSync(sourceRoot)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .sort()
    .map((name) => readFileSync(path.join(sourceRoot, name), "utf8"))
    .join("\n");
}

function packageJson(packageName: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(
    readFileSync(
      path.join(workspaceRoot, "packages", packageName, "package.json"),
      "utf8"
    )
  );
}

describe("package boundaries", () => {
  it("keeps core independent from UI, runtime, CLI, and Node.js", () => {
    const source = sourceText("core");
    expect(source).not.toMatch(/@vellym-internal\/(runtime-node|ui-react)/);
    expect(source).not.toMatch(/from ["'](?:node:|react)/);
    expect(packageJson("core").dependencies).toEqual({
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
