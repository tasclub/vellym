import type { ReactNode } from "react";
import type { DesignNode } from "../model/types.js";
import type { Radius } from "../model/values.js";
import type { BoardIndex } from "../edit/selection.js";
import { movable, resizable } from "../edit/transform.js";
import { designText } from "../i18n.js";
import { MIXED, NumberField, type FieldValue } from "./fields/number-field.js";
import type { TokenOption } from "./fields/token-button.js";

export type InspectorTab = "design" | "prototype" | "code";
export type PaintList = "fills" | "strokes";
export interface InspectorTarget { board: string; node: DesignNode; index: BoardIndex }
export interface InspectorBoard { name: string; title: string; width?: number; height?: number }
export interface InspectorContext {
  targets: readonly InspectorTarget[];
  /** The boards on the current page (shown when nothing is selected). */
  boards: readonly InspectorBoard[];
  locale: "ja" | "en";
  editable: boolean;
  /** Tokens whose values are lengths (px, rem, numbers). */
  lengthTokens: readonly TokenOption[];
  /** Tokens whose values are colours, and a resolver for previews (token → CSS colour). */
  colorTokens: readonly TokenOption[];
  resolveColor(value: string): string | undefined;
  /** Upload an image and return its asset path (absent in static output). */
  uploadImage?(file: File): Promise<string | undefined>;
  /** The gradient whose stop handles are shown on the canvas (one selected node only). */
  activeGradient?: { list: PaintList; paint: number };
  setActiveGradient(value: { list: PaintList; paint: number } | undefined): void;
  /** Characters last selected while editing a text (formatting then applies to them only). */
  textRange?: { board: string; id: string; start: number; end: number };
  clearTextRange(): void;
  /** Change every target; one call is one operation. `mergeKey` joins quick repeats. */
  update(patch: (target: InspectorTarget) => Partial<DesignNode> | undefined, mergeKey?: string): void;
  selectBoard(name: string): void;
}
export interface InspectorSection {
  id: string;
  tab: InspectorTab;
  when(context: InspectorContext): boolean;
  render(context: InspectorContext): ReactNode;
}

/** Other tickets add their sections here (fills, styles, prototype, code…), in display order. */
export const inspectorSections: InspectorSection[] = [];
export function registerSection(section: InspectorSection) {
  const at = inspectorSections.findIndex(item => item.id === section.id);
  if (at >= 0) inspectorSections[at] = section; else inspectorSections.push(section);
}

/** One value for all targets, or MIXED when they differ. */
export function shared<T>(targets: readonly InspectorTarget[], read: (node: DesignNode) => T): T | typeof MIXED {
  const values = targets.map(target => read(target.node));
  return values.every(value => JSON.stringify(value) === JSON.stringify(values[0])) ? values[0]! : MIXED;
}
const t = (context: InspectorContext, key: keyof typeof designText) => designText[key][context.locale];
const field = (context: InspectorContext, key: string, label: keyof typeof designText, value: FieldValue,
  commit: (value: number | string, step: boolean) => void, options: { min?: number; max?: number; scale?: number; suffix?: string; tokens?: boolean } = {}) =>
  <NumberField key={key} testId={`design-field-${key}`} label={t(context, label)} value={value} onCommit={commit}
    mixedLabel={t(context, "mixed")} disabled={!context.editable} min={options.min} max={options.max}
    scale={options.scale} suffix={options.suffix} tokens={options.tokens ? context.lengthTokens : undefined} />;
const ids = (context: InspectorContext) => context.targets.map(target => `${target.board}/${target.node.id}`).sort().join(",");

registerSection({
  id: "position", tab: "design",
  when: context => context.targets.length > 0,
  render: context => {
    // Each target alone: the board root resizes only; flow children neither move nor resize here.
    const all = (check: (index: BoardIndex, ids: string[]) => string[]) => context.targets.every(target =>
      check(target.index, [target.node.id]).length > 0);
    const canMove = all(movable), canResize = all(resizable);
    const set = (key: "x" | "y" | "width" | "height" | "rotation") => (value: number | string, step: boolean) =>
      context.update(() => ({ [key]: key === "width" || key === "height" ? Math.max(1, Number(value)) : Number(value) }),
        step ? `inspect:${key}:${ids(context)}` : undefined);
    return <section className="design-inspector-section" aria-labelledby="design-section-position">
      <h2 id="design-section-position">{t(context, "sectionPosition")}</h2>
      <div className="design-field-grid">
        {canMove && field(context, "x", "fieldX", shared(context.targets, node => node.x ?? 0), set("x"))}
        {canMove && field(context, "y", "fieldY", shared(context.targets, node => node.y ?? 0), set("y"))}
        {canResize && field(context, "width", "fieldWidth", shared(context.targets, node => node.width), set("width"), { min: 1 })}
        {canResize && field(context, "height", "fieldHeight", shared(context.targets, node => node.height), set("height"), { min: 1 })}
        {canMove && field(context, "rotation", "fieldRotation", shared(context.targets, node => node.rotation ?? 0), set("rotation"), { suffix: "°" })}
      </div>
    </section>;
  }
});

const BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const;
registerSection({
  id: "layer", tab: "design",
  when: context => context.targets.length > 0,
  render: context => {
    const blend = shared(context.targets, node => node.blendMode ?? "normal");
    return <section className="design-inspector-section" aria-labelledby="design-section-layer">
      <h2 id="design-section-layer">{t(context, "sectionLayer")}</h2>
      <div className="design-field-grid">
        {field(context, "opacity", "fieldOpacity", shared(context.targets, node => node.opacity ?? 1),
          (value, step) => context.update(() => ({ opacity: Math.min(1, Math.max(0, Number(value))) }),
            step ? `inspect:opacity:${ids(context)}` : undefined), { min: 0, max: 100, scale: 100, suffix: "%" })}
        <div className="design-field">
          <label htmlFor="design-field-blend">{t(context, "fieldBlend")}</label>
          <select id="design-field-blend" data-testid="design-field-blend" disabled={!context.editable}
            value={blend === MIXED ? "" : blend} onChange={event => {
              const value = event.target.value;
              if (value) context.update(() => ({ blendMode: value === "normal" ? undefined : value }));
            }}>
            {blend === MIXED && <option value="">{t(context, "mixed")}</option>}
            {BLENDS.map(mode => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </div>
      </div>
    </section>;
  }
});

const CORNERS = ["radiusTopLeft", "radiusTopRight", "radiusBottomRight", "radiusBottomLeft"] as const;
const rounded = new Set(["frame", "rectangle", "image", "instance"]);
const corner = (radius: Radius | undefined, i: number) => Array.isArray(radius) ? radius[i] : radius ?? 0;
registerSection({
  id: "radius", tab: "design",
  when: context => context.targets.length > 0 && context.targets.every(target => rounded.has(target.node.type)),
  render: context => <section className="design-inspector-section" aria-labelledby="design-section-radius">
    <h2 id="design-section-radius">{t(context, "sectionRadius")}</h2>
    <div className="design-field-grid">
      {CORNERS.map((label, i) => field(context, `radius-${i}`, label, shared(context.targets, node => corner(node.radius, i)),
        (value, step) => context.update(target => {
          const next = [0, 1, 2, 3].map(n => corner(target.node.radius, n)) as [Radius, Radius, Radius, Radius];
          next[i] = typeof value === "number" ? Math.max(0, value) : value as Radius;
          // Four equal corners are saved as one value.
          const same = next.every(item => JSON.stringify(item) === JSON.stringify(next[0]));
          return { radius: (same ? (next[0] === 0 ? undefined : next[0]) : next) as DesignNode["radius"] };
        }, step ? `inspect:radius-${i}:${ids(context)}` : undefined), { min: 0, tokens: true }))}
    </div>
  </section>
});

registerSection({
  id: "boards", tab: "design",
  when: context => context.targets.length === 0,
  render: context => <section className="design-inspector-section" aria-labelledby="design-section-boards">
    <h2 id="design-section-boards">{t(context, "sectionBoards")}</h2>
    {context.boards.length ? <ul className="design-board-list">
      {context.boards.map(board => <li key={board.name}>
        <button type="button" data-testid={`design-inspector-board-${board.name}`} onClick={() => context.selectBoard(board.name)}>
          <span>{board.title}</span><span className="design-token-value">{board.width ?? "?"}×{board.height ?? "?"}</span>
        </button>
      </li>)}
    </ul> : <p>{t(context, "noBoards")}</p>}
  </section>
});
