import { useRef } from "react";
import type { DesignNode, Paint } from "../model/types.js";
import type { ImageFit } from "../model/values.js";
import { designText } from "../i18n.js";
import { ColorField } from "./color-picker.js";
import { MIXED, NumberField } from "./fields/number-field.js";
import { isGradient } from "./gradient-axis.js";
import { registerSection, shared, type InspectorContext, type PaintList } from "./sections.js";

type Kind = "solid" | "linearGradient" | "radialGradient" | "conicGradient" | "image";
const KINDS: readonly [Kind, keyof typeof designText][] = [
  ["solid", "paintSolid"], ["linearGradient", "paintLinear"], ["radialGradient", "paintRadial"],
  ["conicGradient", "paintConic"], ["image", "paintImage"]
];
const FITS: readonly ImageFit[] = ["cover", "contain", "fill", "tile"];
const kindOf = (paint: Paint): Kind => (paint.type ?? "solid") as Kind;
const firstColor = (paint: Paint) => "color" in paint && typeof paint.color === "string" ? paint.color
  : isGradient(paint) ? paint.stops[0]?.color ?? "#000000" : "#000000";
const t = (context: InspectorContext, key: keyof typeof designText) => designText[key][context.locale];
const ids = (context: InspectorContext) => context.targets.map(target => `${target.board}/${target.node.id}`).sort().join(",");

/** Convert a paint to another kind, keeping its colour where it can. */
export function convertPaint(paint: Paint, kind: Kind): Paint {
  const { opacity, visible, blendMode } = paint;
  const keep = { ...(opacity !== undefined ? { opacity } : {}), ...(visible !== undefined ? { visible } : {}), ...(blendMode ? { blendMode } : {}) };
  const color = firstColor(paint);
  if (kind === "solid") return { ...keep, color };
  if (kind === "image") return paint;
  const stops = isGradient(paint) ? paint.stops : [{ position: 0, color }, { position: 1, color: "#ffffff" }];
  if (kind === "radialGradient") return { ...keep, type: kind, stops };
  const angle = isGradient(paint) && typeof paint.angle === "number" ? paint.angle : 90;
  return { ...keep, type: kind, angle, stops };
}

/** Fills or strokes, top-most first, for every selected node at once. */
export function PaintListEditor({ context, list, allowImage, fallback }: {
  context: InspectorContext; list: PaintList; allowImage: boolean; fallback: string;
}) {
  const file = useRef<HTMLInputElement>(null);
  const pendingImage = useRef<number | undefined>(undefined);
  const value = shared(context.targets, node => node[list] ?? []);
  const write = (change: (paints: Paint[]) => Paint[], mergeKey?: string) =>
    context.update(target => ({ [list]: (() => { const next = change(structuredClone(target.node[list] ?? [])); return next.length ? next : undefined; })() } as Partial<DesignNode>), mergeKey);
  const prefix = `design-${list === "fills" ? "fill" : "stroke"}`;
  const head = <div className="design-section-head">
    <h2 id={`design-section-${list}`}>{t(context, list === "fills" ? "sectionFill" : "sectionStroke")}</h2>
    {context.editable && <button type="button" data-testid={`${prefix}-add`} aria-label={t(context, list === "fills" ? "addFill" : "addStroke")}
      onClick={() => write(paints => [...paints, { color: fallback }])}>＋</button>}
  </div>;
  if (value === MIXED) return <>{head}
    <p className="design-inspector-empty">{t(context, "mixed")}</p>
    {context.editable && <button type="button" className="design-inline-button" data-testid={`${prefix}-unify`}
      onClick={() => { const first = structuredClone(context.targets[0]!.node[list] ?? []); context.update(() => ({ [list]: first.length ? first : undefined } as Partial<DesignNode>)); }}>
      {t(context, "makeSame")}</button>}</>;
  const paints = value;
  const upload = async (files: FileList | null) => {
    const index = pendingImage.current;
    pendingImage.current = undefined;
    if (!files?.length || index === undefined || !context.uploadImage) return;
    const path = await context.uploadImage(files[0]!);
    if (path) write(items => items.map((paint, i) => i === index ? { ...convertPaint(paint, "solid"), type: "image", asset: path, fit: "cover" } as Paint : paint));
  };
  return <>{head}
    {allowImage && <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
      data-testid={`${prefix}-image-input`} onChange={event => { void upload(event.target.files); event.target.value = ""; }} />}
    <ol className="design-paint-list">
      {paints.map((paint, index) => ({ paint, index })).reverse().map(({ paint, index }) => {
        const row = `${prefix}-${index}`;
        const set = (patch: (paint: Paint) => Paint, step = false) =>
          write(items => items.map((item, i) => i === index ? patch(item) : item), step ? `paint:${row}:${ids(context)}` : undefined);
        const active = context.activeGradient?.list === list && context.activeGradient.paint === index;
        return <li key={index} className="design-paint" data-testid={row}>
          <div className="design-paint-head">
            <input type="checkbox" checked={paint.visible !== false} disabled={!context.editable} data-testid={`${row}-visible`}
              aria-label={t(context, "paintVisible")} onChange={event => set(item => ({ ...item, visible: event.target.checked ? undefined : false }))} />
            <select aria-label={t(context, "paintKind")} value={kindOf(paint)} disabled={!context.editable} data-testid={`${row}-kind`}
              onChange={event => {
                const kind = event.target.value as Kind;
                if (kind === "image") { if (context.uploadImage) { pendingImage.current = index; file.current?.click(); } return; }
                set(item => convertPaint(item, kind));
              }}>
              {KINDS.filter(([kind]) => kind !== "image" || (allowImage && context.uploadImage) || paint.type === "image")
                .map(([kind, label]) => <option key={kind} value={kind}>{t(context, label)}</option>)}
            </select>
            {context.editable && <span className="design-paint-actions">
              <button type="button" aria-label={t(context, "paintUp")} data-testid={`${row}-up`} disabled={index === paints.length - 1}
                onClick={() => write(items => { const next = [...items]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; })}>↑</button>
              <button type="button" aria-label={t(context, "paintDown")} data-testid={`${row}-down`} disabled={index === 0}
                onClick={() => write(items => { const next = [...items]; [next[index], next[index - 1]] = [next[index - 1]!, next[index]!]; return next; })}>↓</button>
              <button type="button" aria-label={t(context, "paintRemove")} data-testid={`${row}-remove`}
                onClick={() => write(items => items.filter((_, i) => i !== index))}>×</button>
            </span>}
          </div>
          <div className="design-field-grid">
            {(!paint.type || paint.type === "solid") && "color" in paint &&
              <ColorField label={t(context, "paintColor")} value={paint.color} testId={`${row}-color`} disabled={!context.editable}
                tokens={context.colorTokens} resolve={context.resolveColor} onCommit={(color, step) => set(item => ({ ...item, color } as Paint), step)} />}
            {isGradient(paint) && paint.type !== "radialGradient" &&
              <NumberField label={t(context, "paintAngle")} value={"angle" in paint ? paint.angle ?? 0 : 0} suffix="°" testId={`${row}-angle`}
                mixedLabel={t(context, "mixed")} disabled={!context.editable}
                onCommit={(angle, step) => set(item => ({ ...item, angle: Number(angle) } as Paint), step)} />}
            {paint.type === "image" && <div className="design-field">
              <label htmlFor={`${row}-fit`}>{t(context, "paintFit")}</label>
              <select id={`${row}-fit`} data-testid={`${row}-fit`} value={paint.fit ?? "cover"} disabled={!context.editable}
                onChange={event => set(item => ({ ...item, fit: event.target.value as ImageFit } as Paint))}>
                {FITS.map(fit => <option key={fit} value={fit}>{fit}</option>)}
              </select>
            </div>}
            <NumberField label={t(context, "fieldOpacity")} value={paint.opacity ?? 1} scale={100} min={0} max={100} suffix="%"
              testId={`${row}-opacity`} mixedLabel={t(context, "mixed")} disabled={!context.editable}
              onCommit={(opacity, step) => set(item => ({ ...item, opacity: Number(opacity) === 1 ? undefined : Number(opacity) }), step)} />
          </div>
          {isGradient(paint) && <div className="design-stops">
            {paint.stops.map((stop, i) => <div key={i} className="design-stop" data-testid={`${row}-stop-${i}`}>
              <NumberField label={t(context, "stopPosition").replace("{n}", String(i + 1))} value={stop.position} scale={100} min={0} max={100}
                suffix="%" testId={`${row}-stop-${i}-position`} mixedLabel={t(context, "mixed")} disabled={!context.editable}
                onCommit={(position, step) => set(item => ({ ...item, stops: (item as typeof paint).stops.map((s, n) => n === i ? { ...s, position: Number(position) } : s) } as Paint), step)} />
              <ColorField label={t(context, "stopColor").replace("{n}", String(i + 1))} value={stop.color} testId={`${row}-stop-${i}-color`}
                tokens={context.colorTokens} resolve={context.resolveColor} disabled={!context.editable}
                onCommit={(color, step) => set(item => ({ ...item, stops: (item as typeof paint).stops.map((s, n) => n === i ? { ...s, color } : s) } as Paint), step)} />
              {context.editable && paint.stops.length > 2 && <button type="button" className="design-inline-button" data-testid={`${row}-stop-${i}-remove`}
                aria-label={t(context, "stopRemove").replace("{n}", String(i + 1))}
                onClick={() => set(item => ({ ...item, stops: (item as typeof paint).stops.filter((_, n) => n !== i) } as Paint))}>×</button>}
            </div>)}
            {context.editable && <div className="design-stop-actions">
              <button type="button" className="design-inline-button" data-testid={`${row}-stop-add`}
                onClick={() => set(item => {
                  const stops = [...(item as typeof paint).stops].sort((a, b) => a.position - b.position);
                  const last = stops.at(-1)!, before = stops.at(-2) ?? { position: 0, color: last.color };
                  return { ...item, stops: [...stops, { position: Math.round((before.position + last.position) / 2 * 100) / 100, color: last.color }]
                    .sort((a, b) => a.position - b.position) } as Paint;
                })}>{t(context, "stopAdd")}</button>
              {paint.type !== "conicGradient" && context.targets.length === 1 && <button type="button" className="design-inline-button"
                aria-pressed={active} data-testid={`${row}-handles`}
                onClick={() => context.setActiveGradient(active ? undefined : { list, paint: index })}>{t(context, "stopHandles")}</button>}
            </div>}
          </div>}
        </li>;
      })}
    </ol>
  </>;
}

registerSection({
  id: "fill", tab: "design",
  when: context => context.targets.length > 0 && context.targets.every(target => target.node.type !== "line"),
  render: context => <section className="design-inspector-section" aria-labelledby="design-section-fills">
    <PaintListEditor context={context} list="fills" allowImage fallback="#d9d9d9" />
  </section>
});
