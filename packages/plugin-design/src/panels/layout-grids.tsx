import type { DesignNode, LayoutGrid } from "../model/types.js";
import { designText } from "../i18n.js";
import { ColorField } from "./color-picker.js";
import { NumberField } from "./fields/number-field.js";
import { registerSection, type InspectorContext } from "./sections.js";

const t = (context: InspectorContext, key: keyof typeof designText) => designText[key][context.locale];
const PATTERNS: readonly [LayoutGrid["pattern"], keyof typeof designText][] = [["columns", "gridColumns"], ["rows", "gridRows"], ["grid", "gridSquare"]];
const ALIGNMENTS: readonly [NonNullable<LayoutGrid["alignment"]>, keyof typeof designText][] = [
  ["stretch", "gridStretch"], ["start", "gridStart"], ["center", "gridCenter"], ["end", "gridEnd"]
];
const DEFAULTS: Record<LayoutGrid["pattern"], LayoutGrid> = {
  columns: { pattern: "columns", count: 4, gutter: 16, margin: 16, alignment: "stretch" },
  rows: { pattern: "rows", count: 4, gutter: 16, margin: 16, alignment: "stretch" },
  grid: { pattern: "grid", size: 8 }
};

/** Layout grids of one frame (a board root included): columns, rows or a square grid. They show on the canvas and snap. */
registerSection({
  id: "layoutGrids", tab: "design",
  when: context => context.targets.length === 1 && context.targets[0]!.node.type === "frame",
  render: context => {
    const node = context.targets[0]!.node as Extract<DesignNode, { type: "frame" }>;
    const grids = node.layoutGrids ?? [];
    const id = `${context.targets[0]!.board}/${node.id}`;
    const write = (change: (list: LayoutGrid[]) => LayoutGrid[], mergeKey?: string) => context.update(target => {
      const current = (target.node as typeof node).layoutGrids ?? [];
      const next = change(structuredClone(current));
      return { layoutGrids: next.length ? next : undefined } as Partial<DesignNode>;
    }, mergeKey);
    return <section className="design-inspector-section" aria-labelledby="design-section-grids">
      <div className="design-section-head">
        <h2 id="design-section-grids">{t(context, "sectionGrids")}</h2>
        {context.editable && <button type="button" data-testid="design-grid-add" aria-label={t(context, "addGrid")}
          onClick={() => write(list => [...list, { ...DEFAULTS.columns }])}>＋</button>}
      </div>
      <ol className="design-paint-list">
        {grids.map((grid, index) => {
          const row = `design-grid-${index}`;
          const set = (patch: Partial<LayoutGrid>, step = false) =>
            write(list => list.map((item, i) => i === index ? { ...item, ...patch } as LayoutGrid : item), step ? `grid:${index}:${id}` : undefined);
          const num = (key: "count" | "gutter" | "margin" | "size", label: keyof typeof designText, min: number) =>
            <NumberField label={t(context, label)} value={typeof grid[key] === "number" ? grid[key] as number : undefined} min={min}
              testId={`${row}-${key}`} mixedLabel={t(context, "mixed")} disabled={!context.editable}
              onCommit={(value, step) => set({ [key]: key === "count" ? Math.max(1, Math.round(Number(value))) : Number(value) }, step)} />;
          return <li key={index} className="design-paint" data-testid={row}>
            <div className="design-paint-head">
              <input type="checkbox" checked={grid.visible !== false} disabled={!context.editable} aria-label={t(context, "paintVisible")}
                data-testid={`${row}-visible`} onChange={event => set({ visible: event.target.checked ? undefined : false })} />
              <select aria-label={t(context, "gridPattern")} data-testid={`${row}-pattern`} value={grid.pattern} disabled={!context.editable}
                onChange={event => write(list => list.map((item, i) => i === index
                  ? { ...DEFAULTS[event.target.value as LayoutGrid["pattern"]], ...(item.color ? { color: item.color } : {}) } : item))}>
                {PATTERNS.map(([pattern, label]) => <option key={pattern} value={pattern}>{t(context, label)}</option>)}
              </select>
              {context.editable && <span className="design-paint-actions">
                <button type="button" aria-label={t(context, "paintRemove")} data-testid={`${row}-remove`}
                  onClick={() => write(list => list.filter((_, i) => i !== index))}>×</button>
              </span>}
            </div>
            <div className="design-field-grid">
              {grid.pattern === "grid" ? num("size", "gridSize", 1) : <>
                {num("count", "gridCount", 1)}
                {num("gutter", "gridGutter", 0)}
                {(grid.alignment ?? "stretch") === "stretch" ? num("margin", "gridMargin", 0) : num("size", "gridSize", 1)}
                <div className="design-field">
                  <label htmlFor={`${row}-alignment`}>{t(context, "gridAlignment")}</label>
                  <select id={`${row}-alignment`} data-testid={`${row}-alignment`} value={grid.alignment ?? "stretch"} disabled={!context.editable}
                    onChange={event => set({ alignment: event.target.value as LayoutGrid["alignment"],
                      ...(event.target.value !== "stretch" && grid.size === undefined ? { size: 64 } : {}) })}>
                    {ALIGNMENTS.map(([alignment, label]) => <option key={alignment} value={alignment}>{t(context, label)}</option>)}
                  </select>
                </div>
              </>}
              <ColorField label={t(context, "paintColor")} value={grid.color} testId={`${row}-color`} disabled={!context.editable}
                tokens={context.colorTokens} resolve={context.resolveColor} onCommit={(color, step) => set({ color }, step)} />
            </div>
          </li>;
        })}
      </ol>
    </section>;
  }
}, { before: "boards" });
