import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PluginFileRecord } from "@vellym/plugin-api";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import type {
  DesignBoardSpec, DesignCanvasSpec, DesignComponentSpec, DesignNode, DesignStylesSpec
} from "../model/types.js";
import { CREATE_BOARD_COMMAND_ID, type DesignNotice } from "../model/index.js";
import { designText } from "../i18n.js";
import { mergeTokens } from "../tokens/dtcg.js";
import { resolveTokens, tokenToCss } from "../tokens/resolve.js";
import { resolveResolver } from "../tokens/resolver.js";
import { TextEditingContext, TextEditor, useTextEditing, type TextEditing } from "./text-edit.js";
import { nodeCss, type ParentLayout, type StrokeDefinition, type StrokeOverlay } from "./css.js";
import { resolveNode, resolveValue, type ResolveContext } from "./resolve.js";
import { vectorPath, type VectorNode, type VectorPath } from "./vector.js";
import { designAssetUrl, fontFaceCss } from "./fonts.js";
// @ts-expect-error esbuild imports the stylesheet as text, not a runtime CSS module.
import boardCss from "../design.css";

const LocaleContext = createContext("en");
export interface DesignRow<S> { name: string; title?: string; hash?: string; relativePath: string; spec: S }
export interface CanvasRendererData {
  canvas?: DesignRow<DesignCanvasSpec>;
  boards: DesignRow<DesignBoardSpec>[];
  components: DesignRow<DesignComponentSpec>[];
  styles: DesignRow<DesignStylesSpec>[];
  tokenFiles: PluginFileRecord[];
  notices: DesignNotice[];
}

function relativeFile(canvas: string, reference: string): string {
  const parts = canvas.split("/").slice(0, -1);
  for (const part of reference.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export function canvasResolution(data: CanvasRendererData, modes: Readonly<Record<string, string>> = {}) {
  const canvas = data.canvas;
  const files = data.tokenFiles ?? [];
  const settings = canvas?.spec.tokens;
  const resolverPath = settings?.resolver && relativeFile(canvas!.relativePath, settings.resolver);
  const resolver = files.find(file => file.relativePath === resolverPath);
  const selected = (settings?.files ?? []).map(file => files.find(source =>
    source.relativePath === relativeFile(canvas!.relativePath, file))).filter(file => file !== undefined);
  const resolution = resolver
    ? resolveResolver(resolver.value, files, modes, resolver.relativePath)
    : { ...resolveTokens(selected.reduce<unknown>((result, file) => mergeTokens(result, file.value), {})), modifiers: {} };
  const tokens: Record<string, string | number> = Object.create(null);
  for (const token of resolution.tokens) {
    const css = token.type && tokenToCss(token.type, token.value);
    if (css !== undefined) tokens[token.path] = token.type === "number" ? Number(css) : css;
  }
  const context: ResolveContext = {
    tokens, assetUrl: designAssetUrl,
    styles: Object.assign({}, ...data.styles.map(row => row.spec.styles)),
    components: Object.fromEntries(data.components.map(row => [row.name, row.spec]))
  };
  return { context, modifiers: resolution.modifiers };
}

const svgAttributes = (attributes: object) =>
  Object.fromEntries(Object.entries(attributes).map(([key, value]) =>
    [key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), value]));

function Definitions({ definitions }: { definitions: StrokeDefinition[] }) {
  return <defs>{definitions.map(def => {
    const children = <>
      {def.stops?.map((stop, i) => <stop key={i} offset={stop.offset} stopColor={stop.color} />)}
      {def.image && <image href={def.image.href} width="1" height="1"
        preserveAspectRatio={def.image.fit === "fill" ? "none" : def.image.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"} />}
      {def.background && <foreignObject width="1" height="1"><div style={{ width: "100%", height: "100%", background: def.background }} /></foreignObject>}
    </>;
    if (def.type === "linearGradient") return <linearGradient key={def.id} id={def.id} {...def.attributes}>{children}</linearGradient>;
    if (def.type === "radialGradient") return <radialGradient key={def.id} id={def.id} {...def.attributes}>{children}</radialGradient>;
    return <pattern key={def.id} id={def.id} {...def.attributes}>{children}</pattern>;
  })}</defs>;
}

function StrokeLayer({ overlay }: { overlay: StrokeOverlay }) {
  return <svg data-testid="design-stroke-overlay" width="100%" height="100%"
    style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
    <Definitions definitions={overlay.definitions} />
    {overlay.rects.map((rect, i) => <rect key={i} {...svgAttributes(rect)} style={{
      ...rect.style, ...(overlay.radius ? { rx: undefined, borderRadius: overlay.radius } : {})
    }} />)}
  </svg>;
}

const isVector = (node: DesignNode): node is VectorNode =>
  ["ellipse", "line", "polygon", "star", "path", "rectangle"].includes(node.type);

type BooleanRenderer = ReturnType<typeof import("./boolean.js").createBooleanPathRenderer>;
async function geometry(node: DesignNode, renderer: BooleanRenderer, path: string): Promise<VectorPath> {
  if (node.type === "boolean") {
    const children = await Promise.all(node.children.filter(child => child.visible !== false).map(async child => {
      const result = await geometry(child, renderer, `${path}/${child.id}`);
      const angle = (child.rotation ?? 0) * Math.PI / 180;
      const c = Math.cos(angle), s = Math.sin(angle), cx = (child.width ?? 0) / 2, cy = (child.height ?? 0) / 2;
      return { ...result, transform: [c, s, -s, c, (child.x ?? 0) + cx - c * cx + s * cy,
        (child.y ?? 0) + cy - s * cx - c * cy] as const };
    }));
    return { d: await renderer.render(path, node.operation, children), fillRule: "nonzero" };
  }
  return isVector(node) ? vectorPath(node) : { d: "", fillRule: "nonzero" };
}

function Vector({ node, ctx, path }: { node: DesignNode; ctx: ResolveContext; path: string }) {
  const [booleanPath, setBooleanPath] = useState<VectorPath>();
  const renderer = useRef<BooleanRenderer | undefined>(undefined);
  useEffect(() => {
    if (node.type !== "boolean") return;
    let active = true;
    setBooleanPath(undefined);
    void import("./boolean.js").then(async module => {
      renderer.current ??= module.createBooleanPathRenderer();
      const result = await geometry(node, renderer.current, path);
      if (active) setBooleanPath(result);
    });
    return () => { active = false; };
  }, [node, path]);
  useEffect(() => () => renderer.current?.clear(), []);
  const shape = node.type === "boolean" ? booleanPath : isVector(node) ? vectorPath(node) : undefined;
  if (!shape) return null;
  const id = `${path}-clip`;
  const w = node.width ?? 0, h = node.height ?? 0;
  const fills = nodeCss({ ...node, type: "rectangle", strokes: [], shadows: [], opacity: 1, blur: 0 } as DesignNode, undefined, ctx).declarations;
  // SVG owns geometry; foreignObject keeps the exact CSS paint stacking semantics.
  const background: CSSProperties = Object.fromEntries(Object.entries(fills).filter(([key]) => key.startsWith("background")));
  const stroke = nodeCss({ ...node, type: "rectangle", fills: [], strokeDash: node.strokeDash ?? [1] } as DesignNode,
    undefined, { ...ctx, strokeIdPrefix: path }).strokeOverlay;
  const width = resolveValue(node.strokeWidth ?? 1, ctx);
  const strokeWidth = typeof width === "number" ? width : width ?? 1;
  // Open lines have no interior to clip against.
  const align = node.type === "line" ? "center" : node.strokeAlign ?? "inside";
  return <svg data-testid="design-vector" width="100%" height="100%" style={{ overflow: "visible" }}>
    <defs>
      <clipPath id={id}><path d={shape.d} fillRule={shape.fillRule} clipRule={shape.fillRule} /></clipPath>
      <mask id={`${id}-outside`} maskUnits="userSpaceOnUse" x="-100%" y="-100%" width="300%" height="300%">
        <rect x="-100%" y="-100%" width="300%" height="300%" fill="white" />
        <path d={shape.d} fill="black" fillRule={shape.fillRule} />
      </mask>
    </defs>
    <foreignObject width={w} height={h} clipPath={`url(#${id})`}>
      <div style={{ width: "100%", height: "100%", ...background }} />
    </foreignObject>
    {stroke && <><Definitions definitions={stroke.definitions} />
      {stroke.rects.map((rect, i) => <path key={i} d={shape.d} fill="none" stroke={rect.stroke}
        strokeWidth={align === "center" ? strokeWidth : `calc(${typeof strokeWidth === "number" ? `${strokeWidth}px` : strokeWidth} * 2)`}
        strokeDasharray={node.strokeDash?.join(" ")} strokeLinecap={node.strokeCap} strokeLinejoin={node.strokeJoin}
        clipPath={align === "inside" ? `url(#${id})` : undefined}
        mask={align === "outside" ? `url(#${id}-outside)` : undefined}
        opacity={rect.opacity} style={rect.style as CSSProperties} />)}
    </>}
  </svg>;
}

function NodeView({ node, parent, ctx, path }: { node: DesignNode; parent?: ParentLayout; ctx: ResolveContext; path: string }) {
  const locale = useContext(LocaleContext);
  const editing = useTextEditing();
  const vector = ["ellipse", "line", "polygon", "star", "path", "boolean"].includes(node.type);
  const css = nodeCss(vector ? { ...node, fills: [], strokes: [] } as DesignNode : node, parent, { ...ctx, strokeIdPrefix: path });
  let content;
  if (vector) content = <Vector node={node} ctx={ctx} path={path} />;
  else if (node.type === "text" && editing?.id === node.id) content = <TextEditor resolved={node} ctx={ctx} />;
  else if (node.type === "text") content = node.spans ? node.spans.map((span, i) => {
    const style = nodeCss({ id: `${node.id}-${i}`, type: "text", ...span }, undefined, ctx).declarations;
    const { position: _position, boxSizing: _boxSizing, width: _width, whiteSpace: _whiteSpace, ...appearance } = style;
    return <span key={i} style={appearance as CSSProperties}>{span.text}</span>;
  }) : node.text;
  else if (node.type === "image") content = <img src={node.fit === "tile" ? undefined : ctx.assetUrl?.(node.asset)}
    alt={node.alt ?? ""} style={{ width: "100%", height: "100%", display: "block", objectFit: css.declarations.objectFit as CSSProperties["objectFit"],
      visibility: node.fit === "tile" ? "hidden" : undefined }} />;
  else if (node.type === "frame" || node.type === "group") {
    const parentLayout = { ...(node.type === "frame" ? node.layout : {}), width: node.width, height: node.height };
    content = node.children.map(child => <NodeView key={child.id} node={child} parent={parentLayout} ctx={ctx} path={`${path}-${child.id.length}-${child.id}`} />);
  } else if (node.type === "instance") content = <span role="alert">{designText.componentMissing[locale === "ja" ? "ja" : "en"]}</span>;
  // Middle/bottom text sits in one column so its runs stay on shared lines.
  if (node.type === "text" && (node.verticalAlign === "middle" || node.verticalAlign === "bottom")) content = <div style={{ minWidth: 0 }}>{content}</div>;
  return <div data-testid={`design-node-${node.id}`} data-node-id={node.id} data-node-type={node.type}
    style={css.declarations as CSSProperties}>{content}{css.strokeOverlay && <StrokeLayer overlay={css.strokeOverlay} />}</div>;
}

export interface NodeEvent {
  boardName: string;
  nodeId: string;
  trigger: "click" | "hover-enter" | "hover-leave" | "press" | "release";
  rect: DOMRect;
}
interface BoardViewProps {
  board: DesignRow<DesignBoardSpec>;
  context: ResolveContext;
  fontsCss: string;
  locale?: string;
  onNodeEvent?: (event: NodeEvent) => void;
  /** The text being edited in place on this board, if any. */
  editing?: TextEditing;
}

/** The board hash gates tree work; dependencies invalidate only when their content changes. */
export const BoardView = memo(function BoardView({ board, context, fontsCss, locale = "en", onNodeEvent, editing }: BoardViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [shadow, setShadow] = useState<ShadowRoot>();
  useLayoutEffect(() => {
    if (host.current) setShadow(host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" }));
  }, []);
  const root = useMemo(() => resolveNode(board.spec.root, context), [board.hash, board.spec.root, context]);
  useEffect(() => {
    if (!shadow || !onNodeEvent) return;
    const ids = new Set<string>();
    const visit = (node: DesignNode) => {
      if (node.reactions?.length) ids.add(node.id);
      if ("children" in node && Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(root);
    const reactionNode = (target: EventTarget | null) => {
      for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
        if (ids.has(node.getAttribute("data-node-id") ?? "")) return node;
      }
      return undefined;
    };
    const listeners = (["click", "pointerdown", "pointerup", "pointerover", "pointerout"] as const).map(type => {
      const listener = (event: Event) => {
        const node = reactionNode(event.target);
        if (!node) return;
        if (event instanceof PointerEvent && event.button > 0) return;
        const related = event instanceof PointerEvent ? event.relatedTarget : null;
        if ((type === "pointerover" || type === "pointerout") && reactionNode(related) === node) return;
        onNodeEvent({ boardName: board.name, nodeId: node.getAttribute("data-node-id")!,
          trigger: type === "click" ? "click" : type === "pointerdown" ? "press" : type === "pointerup" ? "release" :
            type === "pointerover" ? "hover-enter" : "hover-leave", rect: node.getBoundingClientRect() });
      };
      shadow.addEventListener(type, listener);
      return () => shadow.removeEventListener(type, listener);
    });
    return () => listeners.forEach(remove => remove());
  }, [shadow, root, board.name, onNodeEvent]);
  return <div data-testid={`design-board-${board.name}`} ref={host} style={{
    position: "absolute", left: board.spec.x, top: board.spec.y, width: root.width, height: root.height,
    contentVisibility: "auto", containIntrinsicSize: `${root.width ?? 0}px ${root.height ?? 0}px`
  }}>{shadow && createPortal(<><style>{boardCss + "\n" + fontsCss}</style>
    <LocaleContext.Provider value={locale}><TextEditingContext.Provider value={editing}>
      <div className="design-board-content"><NodeView node={root} ctx={context} path={board.name} /></div>
    </TextEditingContext.Provider></LocaleContext.Provider>
  </>, shadow)}</div>;
}, (a, b) => a.board.name === b.board.name && (a.board.hash !== undefined && b.board.hash !== undefined
  ? a.board.hash === b.board.hash : a.board === b.board) && a.context === b.context && a.fontsCss === b.fontsCss && a.locale === b.locale
  && a.onNodeEvent === b.onNodeEvent && a.editing === b.editing);

export function DesignCanvasView({ context }: PluginViewProps) {
  const data = context.rendererData as unknown as CanvasRendererData;
  const [modes, setModes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const t = (key: keyof typeof designText) => designText[key][context.locale === "ja" ? "ja" : "en"];
  // Host descriptor updates recreate rows. Compare only shared dependencies, not boards.
  const identity = (row: { name?: string; relativePath: string; hash?: string }) =>
    [row.name ?? row.relativePath, row.hash ?? row];
  const dependencyKey = JSON.stringify([data.canvas && identity(data.canvas),
    data.components.map(identity), data.styles.map(identity), data.tokenFiles.map(identity), modes]);
  const resolution = useMemo(() => canvasResolution(data, modes), [dependencyKey]);
  const fonts = fontFaceCss(data.canvas?.spec.fonts ?? []);
  return <section data-testid="design-canvas" style={{ padding: 12 }}>
    <h2>{data.canvas?.title ?? data.canvas?.name ?? t("canvas")}</h2>
    {data.notices?.length > 0 && <div role="alert"><ul>{data.notices.map((notice, i) =>
      <li key={i}>{context.locale === "ja" ? notice.ja : notice.en}</li>)}</ul></div>}
    {Object.entries(resolution.modifiers).map(([modifier, options]) => <label key={modifier}>{modifier}
      <select data-testid={`design-mode-${modifier}`} value={modes[modifier] ?? ""} onChange={event =>
        setModes(previous => {
          const next = { ...previous };
          if (event.target.value) next[modifier] = event.target.value;
          else delete next[modifier];
          return next;
        })}>
        <option value="">{t("defaultMode")}</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select></label>)}
    {!context.isStatic && context.runCommand && <button type="button" data-testid="design-add-board" onClick={() => {
      void context.runCommand?.(CREATE_BOARD_COMMAND_ID, {}).then(result => setStatus(result?.ok === false ? result.message : ""));
    }}>{t("createBoard")}</button>}
    <span role="status">{status}</span>
    {!data.boards?.length && <p>{t("emptyCanvas")}</p>}
    <div data-testid="design-board-stage" style={{ position: "relative", minHeight: 900, overflow: "auto" }}>
      {data.boards?.filter(board => board.spec?.root).map(board =>
        <BoardView key={board.name} board={board} context={resolution.context} fontsCss={fonts} locale={context.locale} />)}
    </div>
  </section>;
}
