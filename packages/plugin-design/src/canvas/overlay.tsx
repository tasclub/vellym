import { useLayoutEffect, useState, type RefObject } from "react";
import type { BoardIndex, Selection } from "../edit/selection.js";
import type { Bounds } from "./viewport.js";
import { rotate, type Handle } from "../edit/transform.js";
import { stopOffset, type Gradient } from "../panels/gradient-axis.js";
import { gridRects, type Distance, type Gap, type Guide } from "../edit/snap.js";
import type { LayoutGrid } from "../model/types.js";

export interface BoardGeometry { name: string; x: number; y: number; index: BoardIndex }
export interface NodeBox extends Bounds { rotation: number }

export function boardElement(world: HTMLElement, name: string): HTMLElement | undefined {
  return [...world.children].find(element => element.getAttribute("data-testid") === `design-board-${name}`) as HTMLElement | undefined;
}

export function measureNode(world: HTMLElement, board: BoardGeometry, id: string): NodeBox | undefined {
  const host = boardElement(world, board.name);
  const node = [...(host?.shadowRoot?.querySelectorAll<HTMLElement>("[data-node-id]") ?? [])]
    .find(element => element.dataset.nodeId === id);
  if (!host || !node || !node.getClientRects().length) return;
  const rect = node.getBoundingClientRect(), boardRect = host.getBoundingClientRect();
  const scale = boardRect.width / host.offsetWidth;
  if (!scale) return;
  let rotation = 0, current: string | undefined = id;
  while (current !== undefined) {
    const item = board.index.get(current);
    rotation += item?.node.rotation ?? 0;
    current = item?.parentId;
  }
  return { x: board.x + (rect.x + rect.width / 2 - boardRect.x) / scale - node.offsetWidth / 2,
    y: board.y + (rect.y + rect.height / 2 - boardRect.y) / scale - node.offsetHeight / 2,
    width: node.offsetWidth, height: node.offsetHeight, rotation };
}

export function enclosing(box: NodeBox): Bounds {
  const angle = box.rotation * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const width = box.width * c + box.height * s, height = box.width * s + box.height * c;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** Handles around the whole selection: one node keeps its rotation, several use their enclosing box. */
export function selectionFrame(boxes: readonly NodeBox[]): NodeBox | undefined {
  if (boxes.length === 1) return boxes[0];
  if (!boxes.length) return;
  const outer = boxes.map(enclosing);
  const x = Math.min(...outer.map(box => box.x)), y = Math.min(...outer.map(box => box.y));
  return { x, y, width: Math.max(...outer.map(box => box.x + box.width)) - x,
    height: Math.max(...outer.map(box => box.y + box.height)) - y, rotation: 0 };
}

const corners = ["nw", "ne", "se", "sw"] as const;
const place: Record<Handle, [number, number]> = {
  nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50]
};

export function Overlay({ world, boards, selection, hover, marquee, revision, onBounds, handles = [], rotatable = false, gradient,
  guides = [], gaps = [], measures = [] }: {
  world: RefObject<HTMLDivElement | null>; boards: BoardGeometry[]; selection: Selection[];
  hover?: Selection; marquee?: Bounds; revision: unknown; onBounds: (bounds?: Bounds) => void;
  /** Resize handles to offer around the selection (none while editing is unavailable). */
  handles?: readonly Handle[]; rotatable?: boolean;
  /** Stop handles for one selected node's gradient, along the same axis the CSS draws. */
  gradient?: { item: Selection; paint: Gradient };
  /** Snapping guides and equal gaps while dragging; Alt+hover distances. */
  guides?: readonly Guide[]; gaps?: readonly Gap[]; measures?: readonly Distance[];
}) {
  const [boxes, setBoxes] = useState<{ item: Selection; box: NodeBox; hover: boolean }[]>([]);
  const [grids, setGrids] = useState<{ key: string; rect: Bounds; color?: string; pattern: LayoutGrid["pattern"] }[]>([]);
  useLayoutEffect(() => {
    const measure = () => {
      if (!world.current) return;
      const next = [...selection.map(item => ({ item, hover: false })),
        ...(hover ? [{ item: hover, hover: true }] : [])].flatMap(entry => {
        const board = boards.find(board => board.name === entry.item.board);
        const box = board && measureNode(world.current!, board, entry.item.id);
        return box ? [{ ...entry, box }] : [];
      });
      setBoxes(next);
      const selected = next.filter(entry => !entry.hover).map(entry => enclosing(entry.box));
      if (!selected.length) onBounds(undefined);
      else {
        const x = Math.min(...selected.map(box => box.x)), y = Math.min(...selected.map(box => box.y));
        onBounds({ x, y, width: Math.max(...selected.map(box => box.x + box.width)) - x,
          height: Math.max(...selected.map(box => box.y + box.height)) - y });
      }
    };
    measure();
    // Layout grids of every frame on the page (unrotated frames only).
    const measureGrids = () => {
      if (!world.current) return;
      setGrids(boards.flatMap(board => [...board.index.values()].flatMap(({ node }) => {
        const list = node.type === "frame" ? node.layoutGrids?.filter(grid => grid.visible !== false) ?? [] : [];
        if (!list.length) return [];
        const box = measureNode(world.current!, board, node.id);
        if (!box || Math.abs(box.rotation) > 0.01) return [];
        return list.flatMap((grid, g) => gridRects(box, grid).map((rect, i) => ({ key: `${board.name}/${node.id}/${g}/${i}`, rect, color: grid.color, pattern: grid.pattern })));
      })));
    };
    measureGrids();
    // Board portals mount in their own layout effect; measure once after that commit too.
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [world, boards, selection, hover, revision, onBounds]);
  const frame = selectionFrame(boxes.filter(entry => !entry.hover).map(entry => entry.box));
  const target = gradient && boxes.find(entry => !entry.hover && entry.item.board === gradient.item.board && entry.item.id === gradient.item.id)?.box;
  const at = (t: number) => {
    if (!target || !gradient) return;
    const offset = stopOffset(gradient.paint, target.width, target.height, t);
    if (!offset) return;
    const turned = rotate(offset.x, offset.y, target.rotation);
    return { x: target.x + target.width / 2 + turned.x, y: target.y + target.height / 2 + turned.y };
  };
  const ends = [at(0), at(1)];
  return <div className="design-overlay" aria-hidden="true">
    {boxes.map(({ item, box, hover }) => <div key={`${hover}/${item.board}/${item.id}`}
      className={hover ? "design-hover" : "design-selection"}
      data-testid={hover ? "design-hover" : "design-selection"} data-node={`${item.board}/${item.id}`}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height, transform: `rotate(${box.rotation}deg)` }} />)}
    {frame && (handles.length > 0 || rotatable) && <div className="design-handles" data-testid="design-handles"
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, transform: `rotate(${frame.rotation}deg)` }}>
      {rotatable && corners.map(corner => <div key={corner} className={`design-rotate design-rotate-${corner}`}
        data-handle={`rotate-${corner}`} data-testid={`design-rotate-${corner}`}
        style={{ left: `${place[corner][0]}%`, top: `${place[corner][1]}%` }} />)}
      {handles.map(handle => <div key={handle} className={`design-handle design-handle-${handle}`}
        data-handle={handle} data-testid={`design-handle-${handle}`}
        style={{ left: `${place[handle][0]}%`, top: `${place[handle][1]}%` }} />)}
    </div>}
    {gradient && ends[0] && ends[1] && <div className="design-gradient" data-testid="design-gradient-handles">
      <svg className="design-gradient-axis" style={{ overflow: "visible", position: "absolute", left: 0, top: 0, width: 1, height: 1 }}>
        <line x1={ends[0].x} y1={ends[0].y} x2={ends[1].x} y2={ends[1].y} />
      </svg>
      {gradient.paint.stops.map((stop, i) => {
        const p = at(stop.position)!;
        return <div key={i} className="design-gradient-stop" data-gradient-stop={i} data-testid={`design-gradient-stop-${i}`}
          style={{ left: p.x, top: p.y, background: stop.color }} />;
      })}
    </div>}
    {grids.map(({ key, rect, color, pattern }) => <div key={key} className={`design-grid design-grid-${pattern}`} data-testid="design-layout-grid"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, ...(color ? { background: color } : {}) }} />)}
    {guides.map((guide, i) => <div key={`g${i}`} className="design-guide" data-testid="design-guide" data-axis={guide.axis}
      style={guide.axis === "x" ? { left: guide.at, top: guide.from, height: guide.to - guide.from }
        : { top: guide.at, left: guide.from, width: guide.to - guide.from }} />)}
    {[...gaps.map(gap => ({ ...gap, kind: "gap" })), ...measures.map(item => ({ ...item, kind: "measure" }))].map((item, i) =>
      <div key={`m${i}`} className={`design-measure design-measure-${item.axis}`} data-testid={item.kind === "gap" ? "design-gap" : "design-distance"}
        style={item.axis === "x" ? { left: item.from, top: item.at, width: item.to - item.from } : { top: item.from, left: item.at, height: item.to - item.from }}>
        <span>{item.size}</span>
      </div>)}
    {marquee && <div className="design-marquee" data-testid="design-marquee"
      style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
  </div>;
}
