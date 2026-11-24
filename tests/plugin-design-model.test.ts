import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { validateKindSpec } from "@vellym-internal/core";
import {
  DESIGN_BOARD_SPEC_SCHEMA, DESIGN_CANVAS_SPEC_SCHEMA, DESIGN_COMPONENT_SPEC_SCHEMA,
  DESIGN_NODE_SCHEMA, DESIGN_SCHEMA_DEFS, DESIGN_STYLES_SPEC_SCHEMA
} from "../packages/plugin-design/src/model/schema.js";
import type {
  DesignBoardSpec, DesignCanvasSpec, DesignComponentSpec, DesignNode, DesignStylesSpec
} from "../packages/plugin-design/src/model/types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateNode = ajv.compile(DESIGN_NODE_SCHEMA);
const validateBoard = ajv.compile<DesignBoardSpec>(DESIGN_BOARD_SPEC_SCHEMA);
const validateCanvas = ajv.compile<DesignCanvasSpec>(DESIGN_CANVAS_SPEC_SCHEMA);
const validateComponent = ajv.compile<DesignComponentSpec>(DESIGN_COMPONENT_SPEC_SCHEMA);
const validateStyles = ajv.compile<DesignStylesSpec>(DESIGN_STYLES_SPEC_SCHEMA);
const frame = { id: "root", type: "frame", children: [] } satisfies DesignNode;

describe("design format 1 documented examples", () => {
  // Copied from sections 5, 6 and 9, not from implementation-generated fixtures.
  const component: DesignComponentSpec = {
    canvas: "app", page: "parts", x: 0, y: 0,
    properties: {
      size: { type: "variant", options: ["small", "medium"], default: "medium" },
      state: { type: "variant", options: ["default", "hover", "disabled"], default: "default" },
      label: { type: "text", default: "ボタン" },
      showIcon: { type: "boolean", default: false },
      icon: { type: "instanceSwap", default: "icon-arrow" }
    },
    variants: [
      { id: "medium-default", values: { size: "medium", state: "default" }, root: {
        id: "root", type: "frame", styles: ["button-primary"], sizing: { width: "hug", height: "hug" },
        layout: { display: "flex", alignItems: "center", gap: 8 }, padding: [12, 20, 12, 20],
        children: [
          { id: "icon", type: "instance", component: "icon-arrow", bind: { visible: "showIcon", component: "icon" } },
          { id: "label", type: "text", text: "ボタン", styles: ["label-m"], bind: { text: "label" } }
        ]
      } },
      { id: "small-default", values: { size: "small", state: "default" },
        root: { id: "root", type: "frame", padding: [8, 12, 8, 12], children: [] } }
    ]
  };
  const styles: DesignStylesSpec = { styles: {
    "heading-l": { fontFamily: "Noto Sans JP", fontSize: 24, fontWeight: 700, lineHeight: 32, fills: [{ color: "{color.text}" }] },
    "button-primary": { fills: [{ color: "{color.accent}" }], radius: 8 }
  } };
  const canvas: DesignCanvasSpec = {
    formatVersion: 1, pages: [{ id: "main", title: "画面" }, { id: "parts", title: "部品" }],
    notes: [{ page: "main", x: 0, y: -200, text: "スマホ", kind: "title" }],
    styles: "app-styles", tokens: { files: ["tokens.tokens.json"], resolver: "tokens.resolver.json" },
    fonts: [{ family: "Noto Sans JP", source: "google", weights: [400, 700], path: "assets/fonts/noto-sans-jp/" }]
  };
  const board: DesignBoardSpec = {
    canvas: "app", page: "main", x: 0, y: 0, startingPoint: true, implementedBy: ["src/pages/Home.tsx"],
    root: { id: "n1", type: "frame", width: 390, height: 844, fills: [{ color: "{color.surface}" }],
      layout: { display: "flex", flexDirection: "column", gap: 12 }, padding: 16,
      children: [
        { id: "n2", type: "text", text: "おすすめ", styles: ["heading-l"] },
        { id: "n3", type: "instance", component: "button", properties: { label: "はじめる" } },
        { id: "n4", type: "ellipse", position: "absolute", x: 340, y: 16, width: 24, height: 24,
          fills: [{ color: "{color.accent}" }] }
      ] }
  };
  it.each([
    ["component", validateComponent, component], ["styles", validateStyles, styles],
    ["canvas", validateCanvas, canvas], ["board", validateBoard, board]
  ] as const)("accepts section 5/6/9 %s", (_name, validate, value) => {
    expect(validate(value), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("also validates the actual YAML examples when the internal source is available", () => {
    // docs is an independent private repository and absent in public/archived source.
    let source: string;
    try {
      source = readFileSync("docs/content/20-設計/デザインキャンバスの保存形式.yaml", "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const content = parse(source).spec.blocks[0].content as string;
    const validators = { DesignCanvas: validateCanvas, DesignBoard: validateBoard,
      DesignComponent: validateComponent, DesignStyles: validateStyles };
    for (const match of content.matchAll(/```yaml\n([\s\S]*?)```/g)) {
      // The section 9 block contains two YAML documents.
      for (const text of match[1]!.split(/^---$/m)) {
        const document = parse(text);
        const validate = validators[document.kind as keyof typeof validators];
        if (validate) expect(validate(document.spec), ajv.errorsText(validate.errors)).toBe(true);
      }
    }
  });
});

const nodes: DesignNode[] = [
  frame, { id: "g", type: "group", children: [frame] },
  { id: "r", type: "rectangle" }, { id: "e", type: "ellipse" }, { id: "l", type: "line" },
  { id: "p", type: "polygon", pointCount: 5 }, { id: "s", type: "star", pointCount: 5, innerRadius: 0.5 },
  { id: "path", type: "path", d: "M0 0L10 10Z", fillRule: "evenodd" },
  { id: "b", type: "boolean", operation: "subtract", children: [frame] },
  { id: "t", type: "text", text: "文字", fontSize: "{size.body}", lineHeight: "150%" },
  { id: "i", type: "image", asset: "assets/a.png", fit: "cover", alt: "A" },
  { id: "instance", type: "instance", component: "button", variant: { size: "small" },
    properties: { label: "はじめる", showIcon: true },
    overrides: { label: { fills: [{ color: "#fff" }] }, "icon/glyph": { fills: [{ color: "{color.accent}" }] } } }
];

describe("recursive discriminated nodes", () => {
  it.each(nodes)("accepts $type", (node) => {
    expect(validateNode(node), ajv.errorsText(validateNode.errors)).toBe(true);
    expect(validateNode({ ...frame, children: [node] })).toBe(true);
  });
  it.each(nodes)("requires id and type on $type", (node) => {
    for (const key of ["id", "type"]) {
      const invalid = { ...node };
      delete invalid[key];
      expect(validateNode(invalid)).toBe(false);
      expect(ajv.errorsText(validateNode.errors)).toContain(`must have required property '${key}'`);
    }
  });
  it.each([
    ["frame", "children"], ["group", "children"], ["polygon", "pointCount"],
    ["star", "pointCount"], ["star", "innerRadius"], ["path", "d"],
    ["boolean", "operation"], ["boolean", "children"], ["text", "text"],
    ["image", "asset"], ["instance", "component"]
  ])("reports a missing %s.%s", (type, field) => {
    const invalid = { ...nodes.find((node) => node.type === type)! };
    delete invalid[field];
    expect(validateNode(invalid)).toBe(false);
    expect(ajv.errorsText(validateNode.errors)).toContain(`must have required property '${field}'`);
    const diagnostics = validateKindSpec(
      { canvas: "app", x: 0, y: 0, root: invalid }, "board.yaml", DESIGN_BOARD_SPEC_SCHEMA
    );
    expect(diagnostics.some((diagnostic) =>
      (typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.en ?? "").includes(field)
      && diagnostic.path?.includes("/root"))).toBe(true);
  });
  it.each([
    { ...frame, children: "bad" }, { id: "x", type: "polygon", pointCount: "5" },
    { id: "x", type: "star", pointCount: 5, innerRadius: 2 },
    { id: "x", type: "path", d: 3 }, { id: "x", type: "text", text: 42 },
    { id: "x", type: "image", asset: [] }, { id: "x", type: "instance", component: false },
    { id: "x", type: "boolean", children: [], operation: "difference" },
    { id: "X", type: "rectangle" }, { id: "x".repeat(41), type: "rectangle" },
    { id: "x", type: "text" }, { id: "x", type: "text", text: "", spans: [] }
  ])("rejects invalid node %#", (node) => {
    expect(validateNode(node)).toBe(false);
    expect(ajv.errorsText(validateNode.errors)).toMatch(/must/);
  });
  it("validates spans and preserves narrowing by type", () => {
    const text: DesignNode = { id: "t", type: "text", spans: [
      { text: "日本語", fontFamily: "Noto Sans JP", fontWeight: 700, fills: [{ color: "oklch(62% 0.19 255)" }] }
    ] };
    expect(validateNode(text)).toBe(true);
    function childrenOf(node: DesignNode): DesignNode[] {
      return node.type === "frame" || node.type === "group" || node.type === "boolean" ? node.children : [];
    }
    expect(childrenOf({ ...frame, children: [text] })).toEqual([text]);
  });
});

describe("shared values, appearance, layout and prototype", () => {
  const validateDefinition = (name: keyof typeof DESIGN_SCHEMA_DEFS) => ajv.compile({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: DESIGN_SCHEMA_DEFS, $ref: `#/$defs/${name}`
  });
  it.each([16, -2, "{space.md}", [12, "{space.md}", 12, 20]])("accepts padding %j", (value) => {
    expect(validateDefinition("padding")(value)).toBe(true);
  });
  it.each(["16px", "{space..md}", "{space.md", [1, 2], [1, 2, 3, 4, 5], [1, 2, false, 4]])("rejects padding %j", (value) => {
    expect(validateDefinition("padding")(value)).toBe(false);
  });
  it.each([
    { color: "#1a73e880" }, { type: "solid", color: "{color.primary}" },
    { type: "linearGradient", angle: 45, stops: [{ position: 0, color: "red" }, { position: 1, color: "blue" }] },
    { type: "radialGradient", stops: [{ position: 0.5, color: "oklch(62% 0.19 255)" }] },
    { type: "conicGradient", angle: 90, stops: [] },
    { type: "image", asset: "assets/a.png", fit: "tile", opacity: 0.5, blendMode: "multiply", visible: true }
  ])("accepts paint %#", (value) => {
    expect(validateDefinition("paint")(value)).toBe(true);
  });
  it.each([
    {}, { type: "solid" }, { type: "image" }, { type: "linearGradient" },
    { color: 12 }, { color: "red", opacity: -0.1 },
    { type: "radialGradient", stops: [{ position: 2, color: "red" }] },
    { type: "image", asset: "a", fit: "stretch" }
  ])("rejects paint %#", (value) => {
    expect(validateDefinition("paint")(value)).toBe(false);
  });
  it("covers every layout, appearance and prototype field", () => {
    const value: DesignNode = {
      ...frame, name: "Frame", visible: true, locked: false, rotation: 45,
      sizing: { width: "fill", height: "hug" }, minWidth: "{size.min}", maxWidth: 400,
      minHeight: 0, maxHeight: 800, constraints: { horizontal: "leftRight", vertical: "scale" },
      gridColumn: "1 / 3", gridRow: "2", opacity: 0.5, blendMode: "multiply",
      fills: [{ color: "#fff" }], strokes: [{ color: "red" }], strokeWidth: 2,
      strokeAlign: "outside", strokeDash: [4, 2], strokeCap: "round", strokeJoin: "bevel",
      radius: [0, 2, 4, "{radius.sm}"], shadows: [{ x: 0, y: 2, blur: 4, spread: 1, color: "#0008", inset: true }],
      blur: 1, backgroundBlur: 10, mask: true, styles: ["shared"], clip: true,
      layout: { display: "grid", flexDirection: "column", gap: 10, justifyContent: "space-between",
        alignItems: "baseline", flexWrap: "wrap", rowGap: 2, columnGap: 4,
        gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "auto" },
      layoutGrids: [{ pattern: "columns", count: 12, gutter: 16, margin: 24, size: 10,
        alignment: "stretch", color: "#f004", visible: true }],
      reactions: [{ trigger: "click", action: "navigate", destination: "settings",
        overlay: { position: "center", closeOnOutsideClick: true },
        transition: { type: "slideIn", direction: "left", duration: 300, easing: "ease-out" } }],
      exports: [{ format: "svg", scale: 2 }]
    };
    expect(validateNode(value), ajv.errorsText(validateNode.errors)).toBe(true);
    expect(validateNode({ ...value, opacity: 2 })).toBe(false);
    expect(validateNode({ ...value, width: "{size.width}" })).toBe(false);
  });
  it("validates components and forbids structural overrides/styles", () => {
    expect(validateComponent({ canvas: "app", root: frame })).toBe(true);
    expect(validateComponent({ canvas: "app", root: frame, variants: [] })).toBe(false);
    expect(validateComponent({ canvas: "app" })).toBe(false);
    expect(validateComponent({ canvas: "app", root: frame, properties: { p: { type: "boolean", default: "false" } } })).toBe(false);
    expect(validateStyles({ styles: { a: { layout: { gap: 2 }, padding: 4 } } })).toBe(true);
    expect(validateStyles({ styles: { a: { children: [] } } })).toBe(false);
    expect(validateStyles({ styles: { a: { x: 20 } } })).toBe(false);
    expect(validateStyles({ styles: { a: { component: "button" } } })).toBe(false);
    expect(validateStyles({ styles: { a: { layout: { display: "grid" } } } })).toBe(false);
    expect(validateStyles({ styles: { a: { future: [null], layout: { future: true } } } })).toBe(true);
    expect(validateNode({ id: "i", type: "instance", component: "a", overrides: { label: { children: [] } } })).toBe(false);
  });
  it("requires version 1 and rejects the temporary 1a board shape", () => {
    expect(validateCanvas({})).toBe(false);
    expect(validateCanvas({ formatVersion: 2 })).toBe(false);
    expect(validateCanvas({ formatVersion: "1" })).toBe(false);
    expect(validateBoard({ canvas: "app", x: 0, y: 0, w: 390, h: 844, html: "" })).toBe(false);
  });
  it("allows unknown fields and uninterpreted extension contents without mutation", () => {
    const value = {
      formatVersion: 1, future: { arbitrary: [1, false, null] },
      pages: [{ id: "main", future: true, extensions: { "test.example": [null, 2] } }],
      extensions: { "test.example": { nested: [{ any: "data" }] }, other: null }
    };
    const before = structuredClone(value);
    expect(validateCanvas(value)).toBe(true);
    expect(value).toEqual(before);
    expect(validateNode({ ...frame, future: true, extensions: { "test.example": 42 },
      children: [{ id: "r", type: "rectangle", future: { a: 1 } }] })).toBe(true);
    expect(validateNode({ ...frame, extensions: [] })).toBe(false);
  });
});
