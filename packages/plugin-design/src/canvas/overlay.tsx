import { useLayoutEffect, useState, type RefObject } from "react";
import type { BoardIndex, Selection } from "../edit/selection.js";
import type { Bounds } from "./viewport.js";

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

export function Overlay({ world, boards, selection, hover, marquee, revision, onBounds }: {
  world: RefObject<HTMLDivElement | null>; boards: BoardGeometry[]; selection: Selection[];
  hover?: Selection; marquee?: Bounds; revision: unknown; onBounds: (bounds?: Bounds) => void;
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
  return <div className="design-overlay" aria-hidden="true">
    {boxes.map(({ item, box, hover }) => <div key={`${hover}/${item.board}/${item.id}`}
      className={hover ? "design-hover" : "design-selection"}
      data-testid={hover ? "design-hover" : "design-selection"} data-node={`${item.board}/${item.id}`}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height, transform: `rotate(${box.rotation}deg)` }} />)}
    {marquee && <div className="design-marquee" data-testid="design-marquee"
      style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
  </div>;
}
