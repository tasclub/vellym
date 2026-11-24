import { DESIGN_FORMAT_VERSION, NODE_ID_PATTERN, TOKEN_REFERENCE_PATTERN } from "./values.js";

type Schema = Record<string, unknown>;
const string = { type: "string" };
const number = { type: "number" };
const boolean = { type: "boolean" };
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const choices = (...values: string[]): Schema => ({ type: "string", enum: values });
const array = (items: Schema): Schema => ({ type: "array", items });
// All objects are open deliberately: validation must not discard future fields.
const object = (properties: Schema, required: string[] = []): Schema => ({
  type: "object", properties: { extensions: { type: "object" }, ...properties },
  ...(required.length ? { required } : {}), additionalProperties: true
});
const dictionary = (value: Schema): Schema => ({ type: "object", additionalProperties: value });
const unitInterval = { type: "number", minimum: 0, maximum: 1 };
const length = ref("length");
const color = ref("color");
const imageFit = choices("cover", "contain", "fill", "tile");
const padding = ref("padding");
const paintArray = array(ref("paint"));
const textProperties = {
  fontFamily: string, fontSize: length, fontWeight: { anyOf: [number, string] },
  fontStyle: string,
  lineHeight: { anyOf: [length, { const: "auto" }, { type: "string", pattern: "^-?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)%$" }] },
  letterSpacing: length, textAlign: choices("left", "center", "right", "justify"),
  textDecoration: string, textTransform: string
};
const appearanceProperties = {
  ...textProperties,
  fills: paintArray, strokes: paintArray, strokeWidth: length,
  strokeAlign: choices("inside", "center", "outside"), strokeDash: array(number),
  strokeCap: choices("butt", "round", "square"), strokeJoin: choices("miter", "round", "bevel"),
  radius: padding, shadows: array(ref("shadow")), blur: length, backgroundBlur: length,
  opacity: unitInterval, blendMode: string
};
const layoutStyleProperties = {
  gap: length,
  justifyContent: choices("flex-start", "center", "flex-end", "space-between"),
  alignItems: choices("flex-start", "center", "flex-end", "stretch", "baseline")
};
const nodeProperties = {
  ...appearanceProperties,
  id: { type: "string", pattern: NODE_ID_PATTERN }, name: string,
  visible: boolean, locked: boolean,
  x: number, y: number, width: number, height: number, rotation: number,
  sizing: object({ width: choices("fixed", "hug", "fill"), height: choices("fixed", "hug", "fill") }),
  minWidth: length, maxWidth: length, minHeight: length, maxHeight: length,
  position: choices("auto", "absolute"),
  constraints: object({
    horizontal: choices("left", "right", "center", "leftRight", "scale"),
    vertical: choices("top", "bottom", "center", "topBottom", "scale")
  }),
  gridColumn: string, gridRow: string, mask: boolean, styles: array(string),
  reactions: array(ref("reaction")),
  exports: array(object({ format: choices("png", "svg", "pdf"), scale: number }, ["format"])),
  bind: object({ text: string, visible: string, component: string })
};
const node = (type: string, properties: Schema = {}, required: string[] = []): Schema =>
  object({ ...nodeProperties, type: { const: type }, ...properties }, ["id", "type", ...required]);
const paintBase = { opacity: unitInterval, visible: boolean, blendMode: string };
const paint = (properties: Schema, required: string[]): Schema =>
  object({ ...paintBase, ...properties }, required);
const children = array(ref("node"));
const componentPlacement = { canvas: string, page: string, x: number, y: number };
// Open objects still reject *known* structural fields in appearance-only contexts.
// Truly unknown future fields remain permitted and are never removed.
const nonAppearanceProperties = Object.fromEntries([
  ...Object.keys(nodeProperties).filter((key) => !(key in appearanceProperties)),
  "type", "children", "clip", "layoutGrids", "pointCount", "innerRadius", "d", "fillRule",
  "operation", "asset", "fit", "alt", "component", "variant", "properties", "overrides",
  "text", "spans", "autoResize", "verticalAlign"
].map((key) => [key, false]));
const sharedLayout = object({
  ...layoutStyleProperties, display: false, flexDirection: false, flexWrap: false,
  rowGap: false, columnGap: false, gridTemplateColumns: false, gridTemplateRows: false
});

/** Draft 2020-12 definitions; recursion always targets this document's $defs.node. */
export const DESIGN_SCHEMA_DEFS = {
  tokenReference: { type: "string", pattern: TOKEN_REFERENCE_PATTERN },
  length: { anyOf: [number, ref("tokenReference")] },
  // CSS evolves independently; parsing CSS colors/easing is a renderer concern.
  color: string,
  easing: string,
  padding: {
    anyOf: [length, { type: "array", items: length, minItems: 4, maxItems: 4 }]
  },
  paint: {
    oneOf: [
      paint({ type: { const: "solid" }, color }, ["color"]),
      paint({ type: choices("linearGradient", "conicGradient"), angle: number, stops: array(ref("gradientStop")) }, ["type", "stops"]),
      paint({ type: { const: "radialGradient" }, stops: array(ref("gradientStop")) }, ["type", "stops"]),
      paint({ type: { const: "image" }, asset: string, fit: imageFit }, ["type", "asset"])
    ]
  },
  gradientStop: object({ position: unitInterval, color }, ["position", "color"]),
  shadow: object({ x: length, y: length, blur: length, spread: length, color, inset: boolean }, ["x", "y", "blur", "color"]),
  layout: object({
    ...layoutStyleProperties, display: choices("none", "flex", "grid"),
    flexDirection: choices("row", "column"), flexWrap: choices("nowrap", "wrap"),
    rowGap: length, columnGap: length, gridTemplateColumns: string, gridTemplateRows: string
  }),
  layoutGrid: object({
    pattern: choices("columns", "rows", "grid"), count: number, gutter: length,
    margin: length, size: length, alignment: choices("stretch", "center", "start", "end"),
    color, visible: boolean
  }, ["pattern"]),
  textStyle: object(textProperties),
  textSpan: object({ ...textProperties, text: string, fills: paintArray }, ["text"]),
  transition: object({
    type: choices("instant", "dissolve", "slideIn", "slideOut", "push", "moveIn", "moveOut"),
    direction: choices("left", "right", "top", "bottom"), duration: number, easing: ref("easing")
  }, ["type"]),
  reaction: object({
    trigger: choices("click", "hover", "press"),
    action: choices("navigate", "overlay", "swapOverlay", "closeOverlay", "back", "openUrl"),
    destination: string,
    overlay: object({ position: string, closeOnOutsideClick: boolean }),
    transition: ref("transition")
  }, ["trigger", "action"]),
  nodeOverride: object({
    ...appearanceProperties, text: string, spans: array(ref("textSpan")), visible: boolean,
    children: false
  }),
  node: {
    oneOf: [
      ref("frame"), ref("group"), ref("rectangle"), ref("ellipse"), ref("line"),
      ref("polygon"), ref("star"), ref("path"), ref("boolean"), ref("text"),
      ref("image"), ref("instance")
    ]
  },
  frame: node("frame", {
    children, clip: boolean, layout: ref("layout"), layoutGrids: array(ref("layoutGrid")), padding
  }, ["children"]),
  group: node("group", { children }, ["children"]),
  rectangle: node("rectangle"),
  ellipse: node("ellipse"),
  line: node("line"),
  polygon: node("polygon", { pointCount: { type: "integer", minimum: 3 } }, ["pointCount"]),
  star: node("star", { pointCount: { type: "integer", minimum: 3 }, innerRadius: unitInterval }, ["pointCount", "innerRadius"]),
  path: node("path", { d: string, fillRule: choices("nonzero", "evenodd") }, ["d"]),
  boolean: node("boolean", { operation: choices("union", "subtract", "intersect", "exclude"), children }, ["operation", "children"]),
  text: {
    ...node("text", {
      text: string, spans: array(ref("textSpan")),
      autoResize: choices("none", "height", "widthAndHeight"),
      verticalAlign: choices("top", "middle", "bottom")
    }),
    oneOf: [{ required: ["text"], not: { required: ["spans"] } }, { required: ["spans"], not: { required: ["text"] } }]
  },
  image: node("image", { asset: string, fit: imageFit, alt: string }, ["asset"]),
  instance: node("instance", {
    component: string, variant: dictionary(string),
    properties: dictionary({ anyOf: [string, boolean] }),
    overrides: dictionary(ref("nodeOverride"))
  }, ["component"]),
  componentProperty: {
    oneOf: [
      object({ type: { const: "variant" }, options: array(string), default: string }, ["type", "options", "default"]),
      object({ type: choices("text", "instanceSwap"), default: string }, ["type", "default"]),
      object({ type: { const: "boolean" }, default: boolean }, ["type", "default"])
    ]
  },
  componentVariant: object({
    id: string, values: dictionary(string), root: ref("node")
  }, ["id", "values", "root"]),
  sharedStyle: object({
    ...nonAppearanceProperties, ...appearanceProperties, layout: sharedLayout, padding
  }),
  font: object({
    family: string, source: string, weights: array({ anyOf: [number, string] }), path: string
  }, ["family", "source", "weights", "path"]),
  canvas: object({
    formatVersion: { const: DESIGN_FORMAT_VERSION },
    pages: array(object({ id: string, title: string }, ["id"])),
    notes: array(object({
      page: string, x: number, y: number, text: string, kind: choices("title", "sticky")
    }, ["x", "y", "text"])),
    styles: string, tokens: object({ files: array(string), resolver: string }, ["files"]),
    fonts: array(ref("font"))
  }, ["formatVersion"]),
  board: object({
    ...componentPlacement, startingPoint: boolean, implementedBy: array(string), root: ref("node")
  }, ["canvas", "x", "y", "root"]),
  component: {
    ...object({
      ...componentPlacement, properties: dictionary(ref("componentProperty")),
      root: ref("node"), variants: array(ref("componentVariant"))
    }, ["canvas"]),
    oneOf: [{ required: ["root"], not: { required: ["variants"] } }, { required: ["variants"], not: { required: ["root"] } }]
  },
  styles: object({ styles: dictionary(ref("sharedStyle")) }, ["styles"])
};

const schema = (definition: keyof typeof DESIGN_SCHEMA_DEFS): Schema => ({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $ref: `#/$defs/${definition}`,
  $defs: DESIGN_SCHEMA_DEFS
});
export const DESIGN_NODE_SCHEMA = schema("node");
export const DESIGN_CANVAS_SPEC_SCHEMA = schema("canvas");
export const DESIGN_BOARD_SPEC_SCHEMA = schema("board");
export const DESIGN_COMPONENT_SPEC_SCHEMA = schema("component");
export const DESIGN_STYLES_SPEC_SCHEMA = schema("styles");
