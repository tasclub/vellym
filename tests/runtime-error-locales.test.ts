import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const localeFiles = [
  "packages/ui-react/src/locales/ja.json",
  "packages/ui-react/src/locales/en.json"
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(file)
      : entry.isFile() && entry.name.endsWith(".ts")
        ? [file]
        : [];
  });
}

function runtimeErrorCodes(source: string): string[] {
  const codes = new Set<string>();
  for (const match of source.matchAll(/new\s+RuntimeError\s*\(/g)) {
    const open = match.index! + match[0].lastIndexOf("(") + 1;
    const args: string[] = [];
    let argument = "";
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = open; index < source.length; index += 1) {
      const char = source[index]!;
      if (quote) {
        argument += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
      } else if (char === '"' || char === "'" || char === "`") {
        quote = char;
        argument += char;
      } else if (char === "(" || char === "[" || char === "{") {
        depth += 1;
        argument += char;
      } else if (char === ")" && depth === 0) {
        args.push(argument.trim());
        break;
      } else if (char === ")" || char === "]" || char === "}") {
        depth -= 1;
        argument += char;
      } else if (char === "," && depth === 0) {
        args.push(argument.trim());
        argument = "";
      } else {
        argument += char;
      }
    }
    const code = args[2]?.match(/^["']([A-Z][A-Z0-9_]+)["']$/)?.[1];
    if (code) codes.add(code);
  }
  return [...codes].sort();
}

const runtimeErrorCodesInSource = sourceFiles("packages/runtime-node/src")
  .flatMap((file) => runtimeErrorCodes(readFileSync(file, "utf8")))
  .filter((code, index, all) => all.indexOf(code) === index)
  .sort();

describe("runtime error translations", () => {
  it("discovers the error codes declared by runtime-node", () => {
    expect(runtimeErrorCodesInSource.length).toBeGreaterThan(0);
    expect(runtimeErrorCodesInSource).toContain("BASE_LOCALE");
  });

  for (const file of localeFiles) {
    it(`contains messages for every RuntimeError code in ${file}`, () => {
      const locale = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      const missing = runtimeErrorCodesInSource.filter((code) => !locale[`error.${code}`]?.trim());
      expect(missing).toEqual([]);
    });
  }
});
