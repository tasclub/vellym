import { describe, expect, it } from "vitest";
import { mergeTokens, readTokens } from "../packages/plugin-design/src/tokens/dtcg.js";
import { resolveTokens, tokenToCss, typographyToCss } from "../packages/plugin-design/src/tokens/resolve.js";
import { resolveResolver, resolverInputs } from "../packages/plugin-design/src/tokens/resolver.js";
import { validTokenValue } from "../packages/plugin-design/src/tokens/validate.js";

const color = { colorSpace: "srgb", components: [1, 0, 1], alpha: 1, hex: "#ff00ff" };
const dimension = { value: 16, unit: "px" };
const duration = { value: 200, unit: "ms" };
const bezier = [0.5, 0, 1, 1];
const shadow = { color, offsetX: dimension, offsetY: dimension, blur: dimension, spread: dimension };
const typography = { fontFamily: "Roboto", fontSize: { value: 42, unit: "px" }, fontWeight: 700,
  letterSpacing: { value: 0.1, unit: "px" }, lineHeight: 1.2 };
const token = (type: string, value: unknown) => ({ $type: type, $value: value });
const examples: [string, unknown, string][] = [
  // Format §8–9 examples 41–58; Color §4.1 example 1.
  ["color", color, "color(srgb 1 0 1 / 1)"],
  ["dimension", dimension, "16px"],
  ["fontFamily", ["Helvetica", "Arial", "sans-serif"], '"Helvetica", "Arial", sans-serif'],
  ["fontWeight", "extra-bold", "800"],
  ["number", 2.3, "2.3"],
  ["duration", duration, "200ms"],
  ["cubicBezier", bezier, "cubic-bezier(0.5, 0, 1, 1)"],
  ["shadow", shadow, "16px 16px 16px 16px color(srgb 1 0 1 / 1)"],
  ["gradient", [{ color, position: 0 }, { color, position: 1 }], "linear-gradient(color(srgb 1 0 1 / 1) 0%, color(srgb 1 0 1 / 1) 100%)"],
  ["typography", typography, '700 42px/1.2 "Roboto"'],
  ["border", { color, width: dimension, style: "solid" }, "16px solid color(srgb 1 0 1 / 1)"],
  ["strokeStyle", { dashArray: [{ value: 0.5, unit: "rem" }], lineCap: "round" }, "dashed"],
  ["transition", { duration, delay: { value: 0, unit: "ms" }, timingFunction: bezier }, "200ms cubic-bezier(0.5, 0, 1, 1) 0ms"]
];

describe("DTCG 2025.10 normative fields and CSS values", () => {
  it.each(examples)("reads and converts %s", (type, value, css) => {
    const source = { example: token(type, value) };
    expect(resolveTokens(source).diagnostics).toEqual([]);
    expect(resolveTokens(source).tokens[0]).toMatchObject({ path: "example", type, value });
    expect(tokenToCss(type, value)).toBe(css);
  });
  it("retains typography letter spacing outside the shorthand", () => {
    expect(typographyToCss(typography)).toEqual({ fontFamily: '"Roboto"', fontSize: "42px",
      fontWeight: "700", letterSpacing: "0.1px", lineHeight: "1.2" });
  });
  it("reads color none/alpha/hex and all Color Module spaces without losing their coordinates", () => {
    expect(tokenToCss("color", { ...color, alpha: 0.5 }, { preferColorFallback: true })).toBe("#ff00ff80");
    expect(tokenToCss("color", color, { preferColorFallback: true })).toBe("#ff00ff");
    expect(tokenToCss("color", { colorSpace: "hsl", components: ["none", 0, 100], hex: "#ffffff", alpha: 0.5 }))
      .toBe("hsl(none 0% 100% / 0.5)");
    for (const space of ["srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d65",
      "xyz-d50", "lab", "lch", "oklab", "oklch", "hwb"]) {
      expect(tokenToCss("color", { colorSpace: space, components: [0, 0, 0] })).toBeDefined();
    }
  });
  it("inherits group types, aliases chains and composite values, preserving metadata and source", () => {
    const source = {
      space: { $type: "dimension", $root: { $value: dimension }, small: { $value: { value: 0.5, unit: "rem" } } },
      color: { shadow: token("color", color) },
      shadow: { medium: token("shadow", { ...shadow, color: "{color.shadow}", offsetX: "{space.small}" }) },
      card: { $value: "{shadow.medium}", $extensions: { "example.org": { anything: true } } },
      alias: { $value: "{card}" }
    };
    const before = JSON.stringify(source);
    const result = resolveTokens(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.find(t => t.path === "alias")?.value).toEqual({ ...shadow, offsetX: { value: 0.5, unit: "rem" } });
    expect(result.tokens.find(t => t.path === "card")?.definition.$extensions).toEqual(source.card.$extensions);
    expect(readTokens(source).some(t => t.path === "space.$root")).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("does not flatten array aliases and supports layered/inset shadows and clamped gradients", () => {
    expect(tokenToCss("shadow", [shadow, { ...shadow, inset: true }])).toContain(", inset ");
    expect(tokenToCss("gradient", [{ color, position: -99 }, { color, position: 42 }])).toContain("100%");
    expect(resolveTokens({ base: token("shadow", [shadow]), layers: token("shadow", ["{base}"]) })
      .diagnostics[0]?.code).toBe("DESIGN_TOKEN_INVALID");
  });
  it.each([
    ["dimension", { value: 16, unit: "%" }], ["duration", { value: 1, unit: "px" }],
    ["fontWeight", 1001], ["fontWeight", "Bold"], ["fontFamily", []], ["number", "2"],
    ["color", { ...color, alpha: 2 }], ["color", { ...color, components: [2, 0, 0] }],
    ["color", { ...color, hex: "#fff" }], ["cubicBezier", [2, 0, 1, 1]],
    ["typography", { ...typography, lineHeight: dimension }],
    ["transition", { duration, delay: duration, easing: bezier }],
    ["shadow", { ...shadow, x: dimension }], ["unknown", 2]
  ])("rejects invalid %s values", (type, value) => {
    expect(validTokenValue(String(type), value)).toBe(false);
    expect(tokenToCss(String(type), value)).toBeUndefined();
  });
  it("diagnoses missing references, cycles, wrong alias types and invalid structure in both languages", () => {
    for (const source of [
      { a: { $value: "{b}" }, b: { $value: "{a}" } },
      { a: { $value: "{missing}" } },
      { a: token("number", 400), b: token("fontWeight", "{a}") },
      { a: token("number", 400), b: token("typography", { ...typography, fontWeight: "{a}" }) },
      { "bad.name": token("number", 1) }, { a: 1 }, []
    ]) {
      const result = resolveTokens(source);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]?.message).toMatchObject({ ja: expect.any(String), en: expect.any(String) });
    }
  });
});

const resolver = {
  version: "2025.10",
  sets: { foundation: { sources: [{ $ref: "foundation.tokens.json" }, { gap: token("dimension", dimension) }] } },
  modifiers: { theme: { contexts: {
    light: [{ accent: token("color", color) }],
    dark: [{ accent: token("color", { ...color, components: [0, 0, 0] }) }]
  }, default: "light" } },
  resolutionOrder: [{ $ref: "#/sets/foundation" }, { $ref: "#/modifiers/theme" }]
};
const files = [{ relativePath: "design/foundation.tokens.json", hash: "a", value: {
  gap: token("dimension", { value: 1, unit: "rem" }), button: { $value: "{accent}" }
} }];

describe("Resolver Module 2025.10", () => {
  it("merges ordered sources then resolves aliases using the selected permutation", () => {
    const before = JSON.stringify({ resolver, files });
    const light = resolveResolver(resolver, files, {}, "design/main.resolver.json");
    const dark = resolveResolver(resolver, files, { theme: "dark" }, "design/main.resolver.json");
    expect(light.diagnostics).toEqual([]);
    expect(dark.diagnostics).toEqual([]);
    expect(light.tokens.find(t => t.path === "button")?.value).toEqual(color);
    expect(dark.tokens.find(t => t.path === "button")?.value).toEqual({ ...color, components: [0, 0, 0] });
    expect(dark.tokens.find(t => t.path === "gap")?.value).toEqual(dimension);
    expect([...resolverInputs(resolver, files, "design/main.resolver.json")]).toEqual([{ theme: "light" }, { theme: "dark" }]);
    expect(JSON.stringify({ resolver, files })).toBe(before);
  });
  it("replaces entire tokens rather than merging metadata or their values", () => {
    expect(mergeTokens({ a: { ...token("number", 1), $description: "old" } }, { a: token("number", 2) }))
      .toEqual({ a: token("number", 2) });
  });
  it("supports inline sets/modifiers, local set refs, escaped pointers and shallow sibling overrides", () => {
    const value = {
      version: "2025.10", $defs: { "a/b": { x: token("number", 1) } },
      sets: { base: { sources: [{ $ref: "#/$defs/a~1b" }] } },
      resolutionOrder: [
        { type: "set", name: "base", sources: [{ $ref: "#/sets/base", sources: [{ x: token("number", 2) }] }] },
        { type: "modifier", name: "debug", contexts: { false: [], true: [{ y: token("number", 3) }] }, default: "false" }
      ]
    };
    expect(resolveResolver(value).tokens.map(t => t.value)).toEqual([2]);
    expect(resolveResolver(value, [], { debug: "true" }).tokens.map(t => t.value)).toEqual([2, 3]);
  });
  it.each([
    { theme: "missing" }, { unknown: "dark" }, { theme: true }, { theme: 10 }
  ])("rejects invalid inputs %j", input => {
    expect(resolveResolver(resolver, files, input as unknown as Record<string, string>, "design/main.resolver.json").diagnostics[0]?.code)
      .toBe("DESIGN_RESOLVER_INVALID");
  });
  it("rejects missing inputs without defaults", () => {
    expect(resolveResolver({ ...resolver, modifiers: { theme: { contexts: resolver.modifiers.theme.contexts } } },
      files, {}, "design/main.resolver.json").diagnostics).not.toEqual([]);
  });
  it.each([
    { version: "2024.1", resolutionOrder: [] },
    { version: "2025.10", resolutionOrder: [{ sources: [] }] },
    { version: "2025.10", resolutionOrder: [{ type: "set", name: "a", sources: [] }, { type: "set", name: "a", sources: [] }] },
    { version: "2025.10", modifiers: { a: { contexts: {} } }, resolutionOrder: [] },
    { version: "2025.10", modifiers: { a: { contexts: { a: [] }, default: "missing" } }, resolutionOrder: [] },
    { version: "2025.10", sets: { a: { $ref: "#/sets/a" } }, resolutionOrder: [{ $ref: "#/sets/a" }] },
    { version: "2025.10", sets: { a: { sources: [{ $ref: "#/modifiers/a" }] } }, modifiers: { a: { contexts: { x: [] } } }, resolutionOrder: [] },
    { version: "2025.10", resolutionOrder: [{ $ref: "#/resolutionOrder/0" }] },
    { version: "2025.10", resolutionOrder: [{ type: "set", name: "a", sources: [{ $ref: "https://example.org/a.tokens.json" }] }] },
    { version: "2025.10", resolutionOrder: [{ type: "set", name: "a", sources: [{ $ref: "../missing.tokens.json" }] }] }
  ])("diagnoses invalid definitions/references without IO: %j", value => {
    expect(resolveResolver(value).diagnostics[0]?.code).toBe("DESIGN_RESOLVER_INVALID");
  });
  it("reports aliases after merging with the originating file and does not return broken tokens", () => {
    const broken = [{ ...files[0]!, value: { a: { $value: "{b}" }, b: { $value: "{a}" }, c: { $value: "{missing}" } } }];
    const result = resolveResolver(resolver, broken, {}, "design/main.resolver.json");
    expect(result.diagnostics.map(d => [d.file, d.path, d.code])).toEqual([
      ["design/foundation.tokens.json", "a", "DESIGN_TOKEN_CYCLE"],
      ["design/foundation.tokens.json", "b", "DESIGN_TOKEN_CYCLE"],
      ["design/foundation.tokens.json", "c", "DESIGN_TOKEN_REFERENCE_MISSING"]
    ]);
  });
});
