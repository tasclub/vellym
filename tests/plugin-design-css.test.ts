import { describe, expect, it } from "vitest";
import { nodeCss, type ParentLayout } from "../packages/plugin-design/src/render/css.js";
import { resolveNode, resolveStyles, resolveValue, type ResolveContext } from "../packages/plugin-design/src/render/resolve.js";
import type { DesignNode, DesignComponentSpec, FrameNode } from "../packages/plugin-design/src/model/types.js";

const rect = (extra: Partial<DesignNode> = {}): DesignNode => ({ id: "box", type: "rectangle", width: 80, height: 40, x: 20, y: 10, ...extra } as DesignNode);
const css = (node: DesignNode, parent?: ParentLayout, ctx?: ResolveContext) => nodeCss(node, parent, ctx).declarations;
const frame = (extra: Partial<FrameNode> = {}): FrameNode => ({ id: "frame", type: "frame", children: [], ...extra });

describe("nodeCss: layout/sizing correspondence", () => {
  it("uses relative border boxes at the root and absolute coordinates in free layout", () => {
    expect(css(rect())).toMatchObject({ boxSizing: "border-box", position: "relative", width: "80px", height: "40px" });
    expect(css(rect(), { display: "none" })).toMatchObject({ position: "absolute", left: "20px", top: "10px" });
    expect(css(rect({ position: "absolute" }), { display: "flex" })).toMatchObject({ position: "absolute", left: "20px", top: "10px" });
    expect(css(rect(), { display: "flex" })).not.toHaveProperty("left");
  });
  it("maps frame flex, free positioning, padding, clipping, alignment and wrapping", () => {
    expect(css(frame())).toMatchObject({ display: "block" });
    expect(css(frame({ layout: {
      display: "flex", flexDirection: "column", gap: 8, rowGap: 9, columnGap: 10,
      justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap",
    }, padding: [1, 2, 3, 4], clip: true }))).toMatchObject({
      display: "flex", flexDirection: "column", gap: "8px", rowGap: "9px", columnGap: "10px",
      justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", padding: "1px 2px 3px 4px", overflow: "hidden",
    });
    expect(css(frame({ padding: 10 }))).toHaveProperty("padding", "10px");
  });
  it.each(["row", "column"] as const)("maps Fixed/Hug/Fill in both axes of %s flex", direction => {
    const parent: ParentLayout = { display: "flex", flexDirection: direction };
    const main = direction === "row" ? "width" : "height", cross = direction === "row" ? "height" : "width";
    expect(css(rect(), parent)).toHaveProperty("flex", "0 0 auto");
    const hug = css(rect({ sizing: { width: "hug", height: "hug" } }), parent);
    expect(hug.flex).toBe("0 0 auto");
    expect(hug).not.toHaveProperty(main); expect(hug).not.toHaveProperty(cross);
    const fill = css(rect({ sizing: { width: "fill", height: "fill" } }), parent);
    expect(fill).toMatchObject({ flex: "1 1 0", alignSelf: "stretch", [main === "width" ? "minWidth" : "minHeight"]: "0px" });
    expect(fill).not.toHaveProperty(main); expect(fill).not.toHaveProperty(cross);
  });
  it("fills free parents and honors explicit min/max over automatic flex minima", () => {
    expect(css(rect({ sizing: { width: "fill", height: "fill" } }), {})).toMatchObject({ width: "100%", height: "100%" });
    expect(css(rect({ sizing: { width: "fill" }, minWidth: 12, maxWidth: 300, minHeight: 4, maxHeight: 50 }), { display: "flex" }))
      .toMatchObject({ minWidth: "12px", maxWidth: "300px", minHeight: "4px", maxHeight: "50px" });
  });
  it("maps grid tracks, gaps, child placement and stretch in both axes", () => {
    expect(css(frame({ layout: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "auto 1fr", columnGap: 12, rowGap: 4 } })))
      .toMatchObject({ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "auto 1fr", columnGap: "12px", rowGap: "4px" });
    expect(css(rect({ gridColumn: "1 / 3", gridRow: "2", sizing: { width: "fill", height: "fill" } }), { display: "grid" }))
      .toMatchObject({ gridColumn: "1 / 3", gridRow: "2", justifySelf: "stretch", alignSelf: "stretch" });
  });
  it("maps text Hug/fixed wrapping, all text formatting, and images", () => {
    const text: DesignNode = { id: "label", type: "text", text: "Hello", fontFamily: "Noto Sans JP", fontSize: 16,
      fontWeight: 700, fontStyle: "italic", lineHeight: "auto", letterSpacing: 2,
      textAlign: "center", textDecoration: "underline", textTransform: "uppercase", fills: [{ color: "red" }] };
    expect(css(text)).toMatchObject({ width: "max-content", whiteSpace: "pre", color: "red",
      fontFamily: "Noto Sans JP", fontSize: "16px", fontWeight: 700, fontStyle: "italic", lineHeight: "normal",
      letterSpacing: "2px", textAlign: "center", textDecoration: "underline", textTransform: "uppercase" });
    expect(css({ ...text, width: 140, sizing: { width: "fixed" }, lineHeight: "150%" })).toMatchObject({ width: "140px", whiteSpace: "pre-wrap", lineHeight: "150%" });
    expect(css({ ...text, lineHeight: 24 })).toHaveProperty("lineHeight", "24px");
    expect(css({ ...text, width: 120, height: 50, autoResize: "none" as const })).toMatchObject({ width: "120px", height: "50px", whiteSpace: "pre-wrap" });
    expect(css({ ...text, width: 120, height: 50, autoResize: "height" as const })).not.toHaveProperty("height");
    expect(css({ ...text, width: 120, height: 50, autoResize: "widthAndHeight" as const })).toHaveProperty("width", "max-content");
    for (const fit of ["cover", "contain", "fill"] as const) {
      expect(css({ id: "image", type: "image", asset: "photo.png", fit })).toHaveProperty("objectFit", fit);
    }
    expect(css({ id: "image", type: "image", asset: "photo.png", fit: "tile" })).toMatchObject({ backgroundRepeat: "repeat" });
  });
});

describe("constraints", () => {
  it.each([
    ["left", "top", { left: "20px", top: "10px", width: "80px", height: "40px" }],
    ["right", "bottom", { right: "100px", bottom: "50px", width: "80px", height: "40px" }],
    ["center", "center", { left: "calc(50% + -40px)", top: "calc(50% + -20px)", translate: "-50% -50%" }],
    ["leftRight", "topBottom", { left: "20px", right: "100px", top: "10px", bottom: "50px" }],
    ["scale", "scale", { left: "10%", top: "10%", width: "40%", height: "40%" }],
  ] as const)("maps %s/%s with original parent dimensions", (horizontal, vertical, expected) => {
    const result = css(rect({ constraints: { horizontal, vertical } }), { width: 200, height: 100 });
    expect(result).toMatchObject(expected);
    if (horizontal === "leftRight") { expect(result).not.toHaveProperty("width"); expect(result).not.toHaveProperty("height"); }
    if (horizontal === "right") { expect(result).not.toHaveProperty("left"); expect(result).not.toHaveProperty("top"); }
  });
  it("does not constrain flow items or divide by zero", () => {
    expect(css(rect({ constraints: { horizontal: "right" } }), { display: "flex", width: 200 })).not.toHaveProperty("right");
    expect(css(rect({ constraints: { horizontal: "scale" } }), { width: 0 }).width).toBe("80px");
  });
});

describe("paints and effects", () => {
  it("reverses fill layers (last saved paint is topmost) and keeps image metadata aligned", () => {
    const result = css(rect({ fills: [{ color: "red" }, { type: "image", asset: "a b.png", fit: "tile" }, { color: "blue", opacity: 0.5 }] }));
    expect(result.backgroundImage).toBe('linear-gradient(color-mix(in srgb, blue 50%, transparent), color-mix(in srgb, blue 50%, transparent)), url("/api/v1/assets?path=a%20b.png"), linear-gradient(red, red)');
    expect(result.backgroundRepeat).toBe("no-repeat, repeat, no-repeat");
    expect(result.backgroundSize).toBe("auto, auto, auto");
  });
  it.each([
    ["linearGradient", "linear-gradient(45deg, red 0%, blue 100%)"],
    ["radialGradient", "radial-gradient(red 0%, blue 100%)"],
    ["conicGradient", "conic-gradient(from 45deg, red 0%, blue 100%)"],
  ] as const)("maps %s", (type, expected) => {
    expect(css(rect({ fills: [{ type, angle: 45, stops: [{ position: 0, color: "red" }, { position: 1, color: "blue" }] }] })).backgroundImage).toBe(expected);
  });
  it("handles image fill fits, visibility, blending, and safe asset quoting", () => {
    for (const [fit, expected] of [["cover", "cover"], ["contain", "contain"], ["fill", "100% 100%"]] as const) {
      expect(css(rect({ fills: [{ type: "image", asset: "photo", fit }] })).backgroundSize).toBe(expected);
    }
    expect(css(rect({ fills: [{ color: "red", visible: false }, { color: "blue", blendMode: "multiply" }] })).backgroundBlendMode).toBe("multiply");
    expect(css(rect({ fills: [{ type: "image", asset: "photo" }] }), undefined, { assetUrl: () => 'x"); color:red;' }).backgroundImage)
      .toBe('url("x\\"); color:red;")');
  });
  it("maps corners, ellipse, shadows, blur, opacity, blend, rotation and hidden state", () => {
    expect(css(rect({ radius: [1, 2, 3, 4], shadows: [
      { x: 1, y: 2, blur: 3, color: "red" }, { x: 0, y: 1, blur: 2, spread: 4, color: "blue", inset: true },
    ], blur: 2, backgroundBlur: 5, opacity: 0.4, blendMode: "multiply", rotation: 30, visible: false })))
      .toMatchObject({ borderRadius: "1px 2px 3px 4px", boxShadow: "1px 2px 3px 0px red, inset 0px 1px 2px 4px blue",
        filter: "blur(2px)", backdropFilter: "blur(5px)", opacity: 0.4, mixBlendMode: "multiply", rotate: "30deg", display: "none" });
    expect(css({ id: "oval", type: "ellipse" }).borderRadius).toBe("50%");
    expect(css({ id: "t", type: "text", text: "Gradient", fills: [{ type: "radialGradient", stops: [{ position: 0, color: "red" }] }] }))
      .toMatchObject({ backgroundClip: "text", color: "transparent" });
  });
});

describe("strokes", () => {
  it.each(["inside", "center", "outside"] as const)("routes single solid %s strokes to CSS and preserves effects", strokeAlign => {
    const result = nodeCss(rect({ strokes: [{ color: "red" }], strokeWidth: 6, strokeAlign, shadows: [{ x: 1, y: 1, blur: 2, color: "black" }] }));
    expect(result.strokeOverlay).toBeUndefined();
    const half = strokeAlign === "center" ? "calc(6px / 2)" : "6px";
    expect(result.declarations.boxShadow).toBe(strokeAlign === "outside" ? "1px 1px 2px 0px black" : `inset 0 0 0 ${half} red, 1px 1px 2px 0px black`);
    if (strokeAlign !== "inside") expect(result.declarations.outline).toBe(`${half} solid red`);
  });
  it.each([["inside", 3, 74, 34], ["center", 0, 80, 40], ["outside", -3, 86, 46]] as const)(
    "routes dashed %s strokes to offset SVG rects", (strokeAlign, x, width, height) => {
      const result = nodeCss(rect({ strokes: [{ color: "red" }], strokeWidth: 6, strokeAlign, strokeDash: [8, 3, 2, 3], radius: 8, strokeCap: "round", strokeJoin: "bevel" }));
      expect(result.declarations).not.toHaveProperty("outline"); expect(result.declarations).not.toHaveProperty("boxShadow");
      expect(result.strokeOverlay?.rects[0]).toMatchObject({ x, y: x, width, height, stroke: "red", fill: "none", "stroke-width": "6px", "stroke-dasharray": "8 3 2 3", "stroke-linecap": "round", "stroke-linejoin": "bevel" });
      expect(result.strokeOverlay?.rects[0]?.rx).toBe(8 - x);
    });
  it("provides gradient and image definitions, handles multiple strokes in saved order", () => {
    const result = nodeCss(rect({ strokes: [
      { color: "red" }, { type: "linearGradient", angle: 45, stops: [{ position: 0, color: "blue" }] },
      { type: "radialGradient", stops: [{ position: 1, color: "green" }] },
      { type: "conicGradient", stops: [{ position: 0, color: "yellow" }] },
      { type: "image", asset: "image", fit: "contain", opacity: 0.4 },
    ] }));
    expect(result.strokeOverlay?.rects.map(r => r.stroke)).toEqual(["red", "url(#stroke-box-1)", "url(#stroke-box-2)", "url(#stroke-box-3)", "url(#stroke-box-4)"]);
    expect(result.strokeOverlay?.definitions.map(d => d.type)).toEqual(["linearGradient", "radialGradient", "pattern", "pattern"]);
    expect(result.strokeOverlay?.definitions[0]?.stops).toEqual([{ offset: "0%", color: "blue" }]);
    expect(result.strokeOverlay?.definitions[2]?.background).toBe("conic-gradient(from 0deg, yellow 0%)");
    expect(result.strokeOverlay?.definitions[3]?.image).toEqual({ href: "/api/v1/assets?path=image", fit: "contain" });
    expect(result.strokeOverlay?.rects.at(-1)?.opacity).toBe(0.4);
  });
  it("uses relative overlay dimensions for Hug/Fill and defers native SVG shape strokes", () => {
    const result = nodeCss({ id: "f", type: "frame", children: [], strokes: [{ color: "red" }], strokeDash: [2, 2] });
    expect(result.strokeOverlay?.rects[0]?.width).toBe("calc(100% - 1px * 1)");
    expect(nodeCss({ id: "e", type: "ellipse", strokes: [{ color: "red" }] }).strokeOverlay).toBeUndefined();
    expect(nodeCss(rect({ sizing: { width: "fill" }, strokes: [{ color: "red" }], strokeDash: [2, 2] })).strokeOverlay?.rects[0]?.width)
      .toBe("calc(100% - 1px * 1)");
  });
  it("supports token geometry and per-instance SVG definition namespaces", () => {
    const result = nodeCss(rect({ strokeWidth: "{stroke.width}", radius: "{radius.small}", strokeDash: [1, 1], strokes: [{ type: "radialGradient", stops: [{ color: "{color.brand}", position: 0 }] }] }),
      undefined, { strokeIdPrefix: "board-instance", tokens: { "stroke.width": 4, "radius.small": 8, "color.brand": "red" } });
    expect(result.strokeOverlay?.rects[0]).toMatchObject({ x: 2, rx: 6, stroke: "url(#stroke-board-instance-box-0)" });
    expect(result.strokeOverlay?.definitions[0]?.stops).toEqual([{ offset: "0%", color: "red" }]);
  });
});

describe("resolution", () => {
  it("resolves token values, alias chains, variables and omissions with structured diagnostics", () => {
    const diagnostics: unknown[] = [];
    const ctx: ResolveContext = { tokens: { "space.md": 16, "space.alias": "{space.md}", "color.primary": "#123", loop: "{loop}" }, onDiagnostic: d => diagnostics.push(d) };
    expect(css(rect({ minWidth: "{space.alias}", fills: [{ color: "{color.primary}" }] }), undefined, ctx))
      .toMatchObject({ minWidth: "16px", backgroundImage: "linear-gradient(#123, #123)" });
    expect(css(rect({ minWidth: "{space.md}", fills: [{ color: "{color.primary}" }] }), undefined, { tokenMode: "variable" }))
      .toMatchObject({ minWidth: "var(--space-md)", backgroundImage: "linear-gradient(var(--color-primary), var(--color-primary))" });
    expect(css(rect({ minWidth: "{missing}" }), undefined, ctx)).not.toHaveProperty("minWidth");
    expect(resolveValue("{loop}", ctx)).toBeUndefined();
    expect(diagnostics).toEqual([{ code: "missing-token", reference: "missing" }, { code: "cyclic-token", reference: "loop" }]);
    expect(resolveValue("{a}", { resolveToken: () => 12 })).toBe(12);
  });
  it("applies styles in order, then node values, merging layout fields without mutation", () => {
    const node = frame({ styles: ["a", "b"], layout: { display: "flex", gap: 20 }, opacity: 0.9 });
    const ctx: ResolveContext = { styles: { a: { opacity: 0.2, radius: 5, layout: { gap: 1, alignItems: "center" } }, b: { radius: 9, layout: { gap: 8 } } } };
    expect(resolveStyles(node, ctx)).toMatchObject({ opacity: 0.9, radius: 9, layout: { display: "flex", gap: 20, alignItems: "center" } });
    expect(node.layout).toEqual({ display: "flex", gap: 20 });
    expect(ctx.styles?.a?.radius).toBe(5);
  });
  const icon: DesignComponentSpec = { canvas: "app", root: frame({ children: [{ id: "glyph", type: "rectangle", fills: [{ color: "black" }] }] }) };
  const button: DesignComponentSpec = { canvas: "app", properties: {
    size: { type: "variant", options: ["small", "large"], default: "small" },
    label: { type: "text", default: "Default" }, show: { type: "boolean", default: false },
    icon: { type: "instanceSwap", default: "icon" },
  }, variants: [
    { id: "small", values: { size: "small" }, root: frame({ padding: 4, children: [
      { id: "label", type: "text", spans: [{ text: "Original" }], bind: { text: "label", visible: "show" } },
      { id: "icon", type: "instance", component: "missing", bind: { component: "icon" } },
    ] }) },
    { id: "large", values: { size: "large" }, root: frame({ padding: 16, children: [] }) },
  ] };
  it("expands defaults, properties, instance swaps and nested overrides without changing source", () => {
    const original = JSON.stringify(button);
    const resolved = resolveNode({ id: "instance", type: "instance", component: "button", x: 100,
      properties: { label: "Hello", show: true },
      overrides: { label: { text: "Override", fontWeight: 700 }, "icon/glyph": { fills: [{ color: "red" }] } },
    }, { components: { button, icon } }) as FrameNode;
    expect(resolved).toMatchObject({ id: "instance", type: "frame", x: 100, padding: 4 });
    expect(resolved.children[0]).toMatchObject({ type: "text", text: "Override", visible: true, fontWeight: 700 });
    expect(resolved.children[0]).not.toHaveProperty("spans");
    expect((resolved.children[1] as FrameNode).children[0]).toMatchObject({ fills: [{ color: "red" }] });
    expect(JSON.stringify(button)).toBe(original);
    const defaults = resolveNode({ id: "i", type: "instance", component: "button" }, { components: { button, icon } }) as FrameNode;
    expect(defaults.children[0]).toMatchObject({ text: "Default", visible: false });
    expect(resolveNode({ id: "i", type: "instance", component: "button", variant: { size: "large" } }, { components: { button } })).toMatchObject({ padding: 16, children: [] });
  });
  it("applies instance appearance over root styles and root appearance", () => {
    const component = { canvas: "app", root: frame({ styles: ["base"], opacity: 0.5, radius: 4 }) };
    expect(resolveNode({ id: "i", type: "instance", component: "c", styles: ["instance"], radius: 9 },
      { components: { c: component }, styles: { base: { opacity: 0.1 }, instance: { opacity: 0.8 } } })).toMatchObject({ opacity: 0.8, radius: 9 });
  });
  it("reports missing/cyclic resources and variants, leaving a renderable unresolved instance", () => {
    const diagnostics: unknown[] = [], ctx: ResolveContext = { onDiagnostic: d => diagnostics.push(d), components: {
      loop: { canvas: "app", root: { id: "cycle", type: "instance", component: "loop" } }, button,
    } };
    expect(resolveNode({ id: "i", type: "instance", component: "loop" }, ctx).type).toBe("instance");
    resolveNode({ id: "i", type: "instance", component: "missing" }, ctx);
    resolveNode({ id: "i", type: "instance", component: "button", variant: { size: "unknown" } }, ctx);
    resolveStyles(rect({ styles: ["unknown"] }), ctx);
    expect(diagnostics).toEqual([
      { code: "cyclic-component", reference: "loop" }, { code: "missing-component", reference: "missing" },
      { code: "missing-variant", reference: "button" }, { code: "missing-style", reference: "unknown" },
    ]);
  });
});
