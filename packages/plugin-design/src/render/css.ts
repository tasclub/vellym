import type { DesignNode, Layout, Length, Paint, Radius } from "../model/types.js";
import { resolveStyles, resolveValue, type ResolveContext } from "./resolve.js";

export type CssDeclarations = Record<string, string | number>;
export interface CssContext extends ResolveContext {
  /** Unique DOM/instance path prefix when a component-local ID is rendered twice. */
  strokeIdPrefix?: string;
}
/** Parent's saved dimensions are needed to preserve constraint offsets on resize. */
export interface ParentLayout extends Layout { width?: number; height?: number }
export interface StrokeDefinition {
  id: string;
  type: "linearGradient" | "radialGradient" | "pattern";
  attributes: Record<string, string | number>;
  stops?: { offset: string; color: string }[];
  /** Pattern content: a renderer can use an SVG image or foreignObject for conic. */
  image?: { href: string; fit: string };
  background?: string;
}
export interface StrokeRect {
  x: string | number; y: string | number; width: string | number; height: string | number;
  rx: string | number;
  fill: "none";
  stroke: string;
  "stroke-width": string | number;
  "stroke-dasharray"?: string;
  "stroke-linecap"?: string;
  "stroke-linejoin"?: string;
  opacity?: number;
  style?: CssDeclarations;
}
export interface StrokeOverlay {
  /** Later rectangles are on top, just like the saved paint array. */
  rects: StrokeRect[];
  definitions: StrokeDefinition[];
  /** Preserve independent corner radii for renderers using a rounded path. */
  radius?: string;
}
export interface NodeCss { declarations: CssDeclarations; strokeOverlay?: StrokeOverlay }

function length(value: Length | undefined, ctx: ResolveContext): string | undefined {
  if (value === undefined) return undefined;
  const resolved = resolveValue(value, ctx);
  return typeof resolved === "number" ? `${resolved}px` : resolved;
}
function color(value: string, ctx: ResolveContext): string | undefined {
  const resolved = resolveValue(value, ctx);
  return resolved === undefined ? undefined : String(resolved);
}
function corners(value: Radius | undefined, ctx: ResolveContext): string | undefined {
  if (value === undefined) return undefined;
  const values = (Array.isArray(value) ? value : [value]).map(v => length(v, ctx));
  return values.some(v => v === undefined) ? undefined : values.join(" ");
}
function alpha(value: string, opacity = 1): string {
  return opacity === 1 ? value : `color-mix(in srgb, ${value} ${opacity * 100}%, transparent)`;
}
function asset(asset: string, ctx: ResolveContext): string | undefined {
  return ctx.assetUrl ? ctx.assetUrl(asset) : `/api/v1/assets?path=${encodeURIComponent(asset)}`;
}
function paintCss(paint: Paint, ctx: ResolveContext): string | undefined {
  if (paint.visible === false) return undefined;
  if (paint.type === "image") {
    const url = asset(paint.asset, ctx);
    // Quotes/control characters cannot escape into another CSS declaration.
    const image = url === undefined ? undefined : `url(${JSON.stringify(url)})`;
    if (!image) return undefined;
    return paint.opacity === undefined || paint.opacity === 1 ? image
      : `cross-fade(${image} ${paint.opacity * 100}%, linear-gradient(transparent, transparent))`;
  }
  if ("stops" in paint && Array.isArray(paint.stops)) {
    const stops = paint.stops.map(stop => {
      const c = color(stop.color, ctx);
      return c === undefined ? undefined : `${alpha(c, paint.opacity)} ${stop.position * 100}%`;
    });
    if (stops.some(s => s === undefined)) return undefined;
    const args = stops.join(", ");
    if (paint.type === "linearGradient") return `linear-gradient(${paint.angle ?? 0}deg, ${args})`;
    if (paint.type === "conicGradient") return `conic-gradient(from ${paint.angle ?? 0}deg, ${args})`;
    return `radial-gradient(${args})`;
  }
  if ("color" in paint && typeof paint.color === "string") {
    const c = color(paint.color, ctx);
    return c === undefined ? undefined : alpha(c, paint.opacity);
  }
  return undefined;
}
function backgrounds(node: DesignNode, css: CssDeclarations, ctx: ResolveContext): void {
  const paints = (node.fills ?? []).flatMap(paint => {
    const value = paintCss(paint, ctx);
    return value === undefined ? [] : [{ paint, value }];
  }).reverse();
  if (!paints.length) return;
  if (node.type === "text" && paints.length === 1 && (!paints[0]!.paint.type || paints[0]!.paint.type === "solid")) {
    css.color = paints[0]!.value;
    return;
  }
  css.backgroundImage = paints.map(({ paint, value }) =>
    !paint.type || paint.type === "solid" ? `linear-gradient(${value}, ${value})` : value).join(", ");
  css.backgroundSize = paints.map(({ paint }) => paint.type !== "image" ? "auto"
    : paint.fit === "fill" ? "100% 100%" : paint.fit === "tile" ? "auto" : paint.fit ?? "cover").join(", ");
  css.backgroundRepeat = paints.map(({ paint }) => paint.type === "image" && paint.fit === "tile" ? "repeat" : "no-repeat").join(", ");
  css.backgroundPosition = paints.map(() => "center").join(", ");
  css.backgroundBlendMode = paints.map(({ paint }) => paint.blendMode ?? "normal").join(", ");
  if (node.type === "text") {
    css.backgroundClip = "text";
    css.WebkitBackgroundClip = "text";
    css.color = "transparent";
  }
}

function constraints(node: DesignNode, parent: ParentLayout, css: CssDeclarations): void {
  for (const horizontal of [true, false]) {
    const start = horizontal ? "left" : "top", end = horizontal ? "right" : "bottom";
    const sizeKey = horizontal ? "width" : "height";
    const p = parent[sizeKey], size = node[sizeKey] ?? 0, offset = (horizontal ? node.x : node.y) ?? 0;
    const mode = horizontal ? node.constraints?.horizontal : node.constraints?.vertical;
    if (p === undefined || mode === undefined) continue;
    if (mode === "right" || mode === "bottom") {
      delete css[start];
      css[end] = `${p - offset - size}px`;
    } else if (mode === "leftRight" || mode === "topBottom") {
      css[end] = `${p - offset - size}px`;
      delete css[sizeKey];
    } else if (mode === "center") {
      css[start] = `calc(50% + ${offset + size / 2 - p / 2}px)`;
      css.translate = horizontal ? "-50% 0" : `${node.constraints?.horizontal === "center" ? "-50%" : "0"} -50%`;
    } else if (mode === "scale" && p !== 0) {
      css[start] = `${offset / p * 100}%`;
      css[sizeKey] = `${size / p * 100}%`;
    }
  }
}

/** Camel-case declarations can be applied as React style or serialized as CSS. */
export function nodeCss(node: DesignNode, parentLayout: ParentLayout | undefined = undefined, ctx: CssContext = {}): NodeCss {
  node = resolveStyles(node, ctx);
  const css: CssDeclarations = { boxSizing: "border-box", position: "relative" };
  const set = (key: string, value: string | number | undefined) => { if (value !== undefined) css[key] = value; };
  const flow = parentLayout?.display === "flex" || parentLayout?.display === "grid";
  const absolute = node.position === "absolute" || (parentLayout !== undefined && !flow);
  if (absolute) {
    css.position = "absolute";
    css.left = `${node.x ?? 0}px`; css.top = `${node.y ?? 0}px`;
  }
  const flex = flow && !absolute && parentLayout?.display === "flex";
  const main = parentLayout?.flexDirection === "column" ? "height" : "width";
  for (const axis of ["width", "height"] as const) {
    const textSizing = node.type === "text"
      ? node.autoResize === "none" || (node.autoResize === "height" && axis === "width") ? "fixed" : "hug"
      : "fixed";
    const sizing = node.sizing?.[axis] ?? textSizing;
    if (sizing === "fixed") set(axis, node[axis] === undefined ? undefined : `${node[axis]}px`);
    if (flex && axis === main) {
      css.flex = sizing === "fill" ? "1 1 0" : "0 0 auto";
      if (sizing === "fill") css[axis === "width" ? "minWidth" : "minHeight"] = "0px";
    } else if (sizing === "fill") {
      if (flow && !absolute) css[parentLayout?.display === "grid" && axis === "width" ? "justifySelf" : "alignSelf"] = "stretch";
      else css[axis] = "100%";
    }
    if (node.type === "text" && axis === "width") {
      css.whiteSpace = sizing === "hug" ? "pre" : "pre-wrap";
      if (sizing === "hug") css.width = "max-content";
    }
  }
  if (absolute && !flow && parentLayout) constraints(node, parentLayout, css);
  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const) set(key, length(node[key], ctx));
  set("gridColumn", node.gridColumn); set("gridRow", node.gridRow);
  if (node.type === "frame") {
    const layout = node.layout;
    css.display = layout?.display === "flex" || layout?.display === "grid" ? layout.display : "block";
    if (css.display !== "block") {
      for (const key of ["flexDirection", "justifyContent", "alignItems", "flexWrap", "gridTemplateColumns", "gridTemplateRows"] as const) set(key, layout?.[key]);
      if (css.display === "flex") {
        css.flexDirection ??= "row";
        css.justifyContent ??= "flex-start"; css.alignItems ??= "flex-start";
      }
      for (const key of ["gap", "rowGap", "columnGap"] as const) set(key, length(layout?.[key], ctx));
    }
    set("padding", corners(node.padding, ctx));
    if (node.clip) css.overflow = "hidden";
  }
  backgrounds(node, css, ctx);
  if (node.type === "ellipse") css.borderRadius = "50%";
  else set("borderRadius", corners(node.radius, ctx));
  set("opacity", node.opacity); set("mixBlendMode", node.blendMode);
  if (node.rotation !== undefined) css.rotate = `${node.rotation}deg`;
  if (node.visible === false) css.display = "none";
  const blur = length(node.blur, ctx), backgroundBlur = length(node.backgroundBlur, ctx);
  if (blur !== undefined) css.filter = `blur(${blur})`;
  if (backgroundBlur !== undefined) css.backdropFilter = `blur(${backgroundBlur})`;
  for (const key of ["fontFamily", "fontWeight", "fontStyle", "textAlign", "textDecoration", "textTransform"] as const) {
    const v = node[key];
    if (v !== undefined) set(key, resolveValue(v, ctx));
  }
  set("fontSize", length(node.fontSize, ctx)); set("letterSpacing", length(node.letterSpacing, ctx));
  if (node.lineHeight !== undefined) set("lineHeight", node.lineHeight === "auto" ? "normal"
    : typeof node.lineHeight === "string" && node.lineHeight.endsWith("%") ? node.lineHeight : length(node.lineHeight as Length, ctx));
  if (node.type === "image") {
    css.objectFit = node.fit === "tile" ? "none" : node.fit ?? "cover";
    if (node.fit === "tile") {
      const url = asset(node.asset, ctx);
      if (url !== undefined) { css.backgroundImage = `url(${JSON.stringify(url)})`; css.backgroundRepeat = "repeat"; }
    }
  }
  const shadows: string[] = [];
  for (const shadow of node.shadows ?? []) {
    const values = [shadow.x, shadow.y, shadow.blur, shadow.spread ?? 0].map(v => length(v, ctx));
    const c = color(shadow.color, ctx);
    if (values.every(v => v !== undefined) && c !== undefined) shadows.push(`${shadow.inset ? "inset " : ""}${values.join(" ")} ${c}`);
  }
  const strokes = (node.strokes ?? []).filter(p => p.visible !== false);
  let strokeOverlay: StrokeOverlay | undefined;
  const box = ["rectangle", "frame", "group", "text", "image", "instance"].includes(node.type);
  const width = length(node.strokeWidth ?? 1, ctx);
  if (box && strokes.length && width !== undefined) {
    const paint = strokes[0]!;
    const solid = strokes.length === 1 && (!paint.type || paint.type === "solid") && !node.strokeDash?.length && (!paint.blendMode || paint.blendMode === "normal");
    const c = paintCss(paint, ctx);
    const align = node.strokeAlign ?? "inside";
    if (solid && c !== undefined) {
      const half = `calc(${width} / 2)`;
      if (align !== "outside") shadows.unshift(`inset 0 0 0 ${align === "center" ? half : width} ${c}`);
      if (align !== "inside") css.outline = `${align === "center" ? half : width} solid ${c}`;
    } else {
      strokeOverlay = makeOverlay(node, strokes, width, ctx);
    }
  }
  if (shadows.length) css.boxShadow = shadows.join(", ");
  return { declarations: css, ...(strokeOverlay ? { strokeOverlay } : {}) };
}

function makeOverlay(node: DesignNode, paints: Paint[], width: string, ctx: CssContext): StrokeOverlay {
  const overlay: StrokeOverlay = { rects: [], definitions: [], radius: corners(node.radius, ctx) };
  const resolved = resolveValue(node.strokeWidth ?? 1, ctx);
  const numeric = typeof resolved === "number" ? resolved : undefined;
  const sign = node.strokeAlign === "outside" ? -1 : node.strokeAlign === "center" ? 0 : 1;
  const inset = numeric === undefined ? `calc(${width} * ${sign / 2})` : numeric * sign / 2;
  const dimension = (axis: "width" | "height") => {
    const constraint = axis === "width" ? node.constraints?.horizontal : node.constraints?.vertical;
    const responsive = node.sizing?.[axis] === "fill" || node.sizing?.[axis] === "hug"
      || constraint === "scale" || constraint === "leftRight" || constraint === "topBottom";
    const value = responsive ? undefined : node[axis];
    return value !== undefined && numeric !== undefined
      ? Math.max(0, value - numeric * sign) : `calc(100% - ${width} * ${sign})`;
  };
  const radiusValue = Array.isArray(node.radius) ? node.radius[0] : node.radius ?? 0;
  const radius = length(radiusValue, ctx) ?? "0px";
  const resolvedRadius = resolveValue(radiusValue, ctx);
  for (const [index, paint] of paints.entries()) {
    const value = paintCss(paint, ctx);
    if (value === undefined) continue;
    let stroke = value;
    if (paint.type && paint.type !== "solid") {
      const id = `stroke-${ctx.strokeIdPrefix ? `${ctx.strokeIdPrefix}-` : ""}${node.id}-${index}`;
      const definition: StrokeDefinition = { id, type: "pattern", attributes: { width: 1, height: 1, patternContentUnits: "objectBoundingBox" } };
      if (paint.type === "linearGradient" || paint.type === "radialGradient") {
        definition.type = paint.type;
        definition.attributes = paint.type === "linearGradient"
          ? { x1: "50%", y1: "100%", x2: "50%", y2: "0%", gradientTransform: `rotate(${paint.angle ?? 0} .5 .5)` } : {};
        definition.stops = paint.stops.flatMap(stop => {
          const c = color(stop.color, ctx);
          return c === undefined ? [] : [{ offset: `${stop.position * 100}%`, color: alpha(c, paint.opacity) }];
        });
      } else if (paint.type === "image") {
        const url = asset(paint.asset, ctx);
        if (url === undefined) continue;
        definition.image = { href: url, fit: paint.fit ?? "cover" };
      } else definition.background = value; // conic gradients use CSS in an SVG foreignObject pattern
      overlay.definitions.push(definition);
      stroke = `url(#${id})`;
    }
    overlay.rects.push({
      x: inset, y: inset, width: dimension("width"), height: dimension("height"),
      rx: typeof resolvedRadius === "number" && typeof inset === "number" ? Math.max(0, resolvedRadius - inset)
        : radius === "0px" ? 0 : `max(0px, calc(${radius} - ${typeof inset === "number" ? `${inset}px` : inset}))`,
      fill: "none", stroke, "stroke-width": width,
      ...(node.strokeDash?.length ? { "stroke-dasharray": node.strokeDash.join(" ") } : {}),
      ...(node.strokeCap ? { "stroke-linecap": node.strokeCap } : {}),
      ...(node.strokeJoin ? { "stroke-linejoin": node.strokeJoin } : {}),
      ...(paint.type === "image" && paint.opacity !== undefined ? { opacity: paint.opacity } : {}),
      ...(paint.blendMode ? { style: { mixBlendMode: paint.blendMode } } : {}),
    });
  }
  return overlay;
}
