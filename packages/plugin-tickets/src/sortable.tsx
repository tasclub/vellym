import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

let counter = 0;
export const newKey = () => `row-${++counter}`;

export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

let activeDrag: { group: string; key: string } | undefined;
const touchRows = new Map<string, {
  mark: (side: "before" | "after" | undefined) => void;
  drop: (source: string, side: "before" | "after") => void;
}>();
let touchTarget: { key: string; side: "before" | "after" } | undefined;

export function SortableRow({ group, rowKey, label, className, rowType, onMove, onDropAt, children }: {
  group: string; rowKey: string; label: string; className: string; rowType: string;
  onMove: (delta: number) => void;
  onDropAt: (source: string, side: "before" | "after") => void;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLSpanElement>(null);
  const [side, setSide] = useState<"before" | "after">();
  const [focus, setFocus] = useState(0);
  useEffect(() => { if (focus) handle.current?.focus(); }, [focus]);
  useEffect(() => {
    touchRows.set(rowKey, { mark: setSide, drop: onDropAt });
    return () => { touchRows.delete(rowKey); };
  }, [rowKey, onDropAt]);
  const position = (event: DragEvent<HTMLDivElement>) =>
    event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? "before" : "after";
  return <div ref={row} className={`${className} tickets-settings-sortable`} data-row={rowType}
    data-drop-side={side} data-sort-group={group} data-sort-key={rowKey}
    onDragOver={(event) => {
      if (activeDrag?.group !== group) return;
      event.preventDefault();
      event.stopPropagation();
      setSide(position(event));
    }}
    onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSide(undefined);
    }}
    onDrop={(event) => {
      if (activeDrag?.group !== group) return;
      event.preventDefault();
      event.stopPropagation();
      onDropAt(activeDrag.key, position(event));
      setSide(undefined);
    }}>
    <span ref={handle} role="button" tabIndex={0} draggable aria-label={label}
      className="tickets-settings-sort-handle"
      onDragStart={(event) => {
        event.stopPropagation();
        activeDrag = { group, key: rowKey };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", rowKey);
        if (row.current) event.dataTransfer.setDragImage(row.current, 16, 16);
      }}
      onDragEnd={(event) => { event.stopPropagation(); activeDrag = undefined; setSide(undefined); }}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        activeDrag = { group, key: rowKey };
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== "touch" || activeDrag?.key !== rowKey) return;
        event.preventDefault();
        touchRows.get(touchTarget?.key ?? "")?.mark(undefined);
        touchTarget = undefined;
        let target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        while (target && target.dataset.sortGroup !== group) target = target.parentElement;
        const key = target?.dataset.sortKey;
        if (!target || !key) return;
        const rect = target.getBoundingClientRect();
        const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        touchTarget = { key, side };
        touchRows.get(key)?.mark(side);
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== "touch" || activeDrag?.key !== rowKey) return;
        event.stopPropagation();
        if (touchTarget) {
          touchRows.get(touchTarget.key)?.drop(rowKey, touchTarget.side);
          touchRows.get(touchTarget.key)?.mark(undefined);
        }
        touchTarget = undefined;
        activeDrag = undefined;
      }}
      onPointerCancel={() => {
        touchRows.get(touchTarget?.key ?? "")?.mark(undefined);
        touchTarget = undefined;
        activeDrag = undefined;
      }}
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        onMove(event.key === "ArrowUp" ? -1 : 1);
        setFocus((value) => value + 1);
      }}>⠿</span>
    {children}
  </div>;
}

export function moveRelative<T extends { key: string }>(list: readonly T[], source: string, target: string, side: "before" | "after"): T[] {
  const from = list.findIndex((row) => row.key === source);
  const targetIndex = list.findIndex((row) => row.key === target);
  if (from < 0 || targetIndex < 0 || from === targetIndex) return [...list];
  const insertion = targetIndex + (side === "after" ? 1 : 0);
  return moveTo(list, from, insertion - (from < insertion ? 1 : 0));
}
