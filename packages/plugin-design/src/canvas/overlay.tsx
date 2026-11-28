import { useLayoutEffect, useState, type RefObject } from "react";
import type { BoardIndex, Selection } from "../edit/selection.js";
import type { Bounds } from "./viewport.js";
import type { Handle } from "../edit/transform.js";

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

export function Overlay({ world, boards, selection, hover, marquee, revision, onBounds, handles = [], rotatable = false }: {
  world: RefObject<HTMLDivElement | null>; boards: BoardGeometry[]; selection: Selection[];
  hover?: Selection; marquee?: Bounds; revision: unknown; onBounds: (bounds?: Bounds) => void;
  /** Resize handles to offer around the selection (none while editing is unavailable). */
  handles?: readonly Handle[]; rotatable?: boolean;
}) {
  const [boxes, setBoxes] = useState<{ item: Selection; box: NodeBox; hover: boolean }[]>([]);
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
    // Board portals mount in their own layout effect; measure once after that commit too.
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [world, boards, selection, hover, revision, onBounds]);
  const frame = selectionFrame(boxes.filter(entry => !entry.hover).map(entry => entry.box));
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
    {marquee && <div className="design-marquee" data-testid="design-marquee"
      style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
  </div>;
}
