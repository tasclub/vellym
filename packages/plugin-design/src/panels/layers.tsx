import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { DesignNode } from "../model/types.js";
import { designText } from "../i18n.js";
import { indexBoard, type Selection } from "../edit/selection.js";
import { dropTarget, isContainer, moveInto, moveOut, moveTo, reorder } from "../edit/tree.js";
import { updateNodes } from "../edit/transform.js";

export interface LayerBoard { name: string; title: string; root: DesignNode }
interface Row { board: string; node: DesignNode; level: number; parent?: string; boardTitle?: string; expandable: boolean }

/**
 * The layer tree of the current page: boards, then their nodes top-most first (as drawn).
 * Selection is the canvas's; every change is one model operation for its board.
 */
export function Layers({ boards, selected, onSelect, apply, editable, locale }: {
  boards: readonly LayerBoard[]; selected: readonly Selection[];
  onSelect(items: Selection[], mode: "replace" | "add" | "toggle"): void;
  /** Replace one board's root (one undo step). Returns whether it applied. */
  apply(board: string, before: DesignNode, after: DesignNode): boolean;
  editable: boolean; locale: "ja" | "en";
}) {
  const t = (key: keyof typeof designText) => designText[key][locale];
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(boards.map(board => board.name)));
  const [focus, setFocus] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [dragging, setDragging] = useState<{ board: string; id: string }>();
  const [drop, setDrop] = useState<{ key: string; place: "above" | "below" | "inside" }>();
  const tree = useRef<HTMLUListElement>(null);
  const key = (board: string, id: string) => `${board}/${id}`;
  const isSelected = (board: string, id: string) => selected.some(item => item.board === board && item.id === id);
  // Show the selection: open its ancestors.
  useEffect(() => {
    if (!selected.length) return;
    setOpen(previous => {
      const next = new Set(previous);
      for (const item of selected) {
        const board = boards.find(row => row.name === item.board);
        if (!board) continue;
        next.add(board.name);
        const index = indexBoard(board.root);
        for (let current = index.get(item.id)?.parentId; current !== undefined; current = index.get(current)?.parentId)
          next.add(key(board.name, current));
      }
      return next.size === previous.size ? previous : next;
    });
  }, [selected, boards]);
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const board of boards) {
      const root = board.root, rootOpen = open.has(board.name);
      out.push({ board: board.name, node: root, level: 1, boardTitle: board.title, expandable: isContainer(root) && root.children.length > 0 });
      if (!rootOpen || !isContainer(root)) continue;
      const visit = (node: DesignNode, level: number, parent: string) => {
        const expandable = isContainer(node) && node.children.length > 0;
        out.push({ board: board.name, node, level, parent, expandable });
        if (expandable && open.has(key(board.name, node.id)))
          [...(node as { children: DesignNode[] }).children].reverse().forEach(child => visit(child, level + 1, node.id));
      };
      [...root.children].reverse().forEach(child => visit(child, 2, root.id));
    }
    return out;
  }, [boards, open]);
  const focused = rows.find(row => key(row.board, row.node.id) === focus) ??
    rows.find(row => isSelected(row.board, row.node.id)) ?? rows[0];
  const focusRow = (row: Row | undefined) => {
    if (!row) return;
    setFocus(key(row.board, row.node.id));
    requestAnimationFrame(() => tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key(row.board, row.node.id))}"]`)?.focus());
  };
  useEffect(() => {
    const row = rows.find(item => isSelected(item.board, item.node.id));
    if (row) tree.current?.querySelector(`[data-key="${CSS.escape(key(row.board, row.node.id))}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const change = (row: Row, make: (root: DesignNode) => DesignNode | undefined) => {
    const board = boards.find(item => item.name === row.board);
    if (!board || !editable) return false;
    const after = make(board.root);
    return !!after && after !== board.root && apply(board.name, board.root, after);
  };
  const toggle = (row: Row, prop: "visible" | "locked") => change(row, root => updateNodes(root, new Map([[row.node.id,
    prop === "visible" ? { visible: row.node.visible === false ? undefined : false } : { locked: row.node.locked ? undefined : true }]])));
  const setOpenRow = (row: Row, value: boolean) => setOpen(previous => {
    const id = row.level === 1 ? row.board : key(row.board, row.node.id), next = new Set(previous);
    if (value) next.add(id); else next.delete(id);
    return next;
  });
  const isOpen = (row: Row) => open.has(row.level === 1 ? row.board : key(row.board, row.node.id));
  const keys = (event: KeyboardEvent<HTMLLIElement>, row: Row) => {
    if (renaming) return;
    const at = rows.indexOf(row);
    if (event.altKey && editable && row.parent !== undefined) {
      const make = event.key === "ArrowUp" ? (root: DesignNode) => reorder(root, row.node.id, 1)
        : event.key === "ArrowDown" ? (root: DesignNode) => reorder(root, row.node.id, -1)
        : event.key === "ArrowLeft" ? (root: DesignNode) => moveOut(root, row.node.id)
        : event.key === "ArrowRight" ? (root: DesignNode) => moveInto(root, row.node.id) : undefined;
      if (make) { event.preventDefault(); change(row, make); requestAnimationFrame(() => focusRow(row)); }
      return;
    }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); focusRow(rows[at + 1]); break;
      case "ArrowUp": event.preventDefault(); focusRow(rows[at - 1]); break;
      case "Home": event.preventDefault(); focusRow(rows[0]); break;
      case "End": event.preventDefault(); focusRow(rows.at(-1)); break;
      case "ArrowRight":
        event.preventDefault();
        if (row.expandable && !isOpen(row)) setOpenRow(row, true); else if (row.expandable) focusRow(rows[at + 1]);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (row.expandable && isOpen(row)) setOpenRow(row, false);
        else focusRow(rows.find(item => item.board === row.board && item.node.id === row.parent));
        break;
      case "Enter": case " ":
        event.preventDefault();
        onSelect([{ board: row.board, id: row.node.id }], event.shiftKey ? "add" : event.ctrlKey || event.metaKey ? "toggle" : "replace");
        break;
      case "F2":
        if (editable && row.level > 1) { event.preventDefault(); setRenaming(key(row.board, row.node.id)); }
        break;
    }
  };
  const place = (event: DragEvent<HTMLElement>, row: Row) => {
    const box = event.currentTarget.getBoundingClientRect(), y = (event.clientY - box.top) / box.height;
    return row.level === 1 ? "inside" : isContainer(row.node) && y > 0.3 && y < 0.7 ? "inside" : y < 0.5 ? "above" : "below";
  };
  if (!rows.length) return <p className="design-inspector-empty" data-testid="design-layers-empty">{t("noBoards")}</p>;
  return <ul ref={tree} role="tree" aria-label={t("layers")} aria-multiselectable="true" className="design-layers" data-testid="design-layers">
    {rows.map(row => {
      const id = key(row.board, row.node.id), name = row.boardTitle ?? row.node.name ?? row.node.id;
      const target = drop?.key === id ? drop.place : undefined;
      return <li key={id} role="treeitem" data-key={id} data-testid={`design-layer-${row.node.id}`} aria-level={row.level}
        aria-selected={isSelected(row.board, row.node.id)} aria-expanded={row.expandable ? isOpen(row) : undefined}
        tabIndex={focused === row ? 0 : -1} className="design-layer" data-drop={target}
        draggable={editable && row.level > 1 && renaming !== id}
        onFocus={event => { if (event.target === event.currentTarget) setFocus(id); }}
        onKeyDown={event => { if (event.target === event.currentTarget) keys(event, row); }}
        onClick={event => {
          if (event.target !== event.currentTarget && (event.target as Element).closest("button, input")) return;
          onSelect([{ board: row.board, id: row.node.id }], event.shiftKey ? "add" : event.ctrlKey || event.metaKey ? "toggle" : "replace");
          setFocus(id);
        }}
        onDoubleClick={event => { if (editable && row.level > 1 && !(event.target as Element).closest("button")) setRenaming(id); }}
        onDragStart={event => { setDragging({ board: row.board, id: row.node.id }); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); }}
        onDragEnd={() => { setDragging(undefined); setDrop(undefined); }}
        onDragOver={event => {
          if (!dragging || dragging.board !== row.board || dragging.id === row.node.id) return;
          event.preventDefault();
          setDrop({ key: id, place: place(event, row) });
        }}
        onDragLeave={() => setDrop(previous => previous?.key === id ? undefined : previous)}
        onDrop={event => {
          event.preventDefault();
          const from = dragging;
          setDragging(undefined); setDrop(undefined);
          if (!from || from.board !== row.board) return;
          const board = boards.find(item => item.name === row.board)!;
          const spot = dropTarget(indexBoard(board.root), row.node.id, place(event, row));
          if (spot) change(row, root => moveTo(root, from.id, spot.parentId, spot.position));
        }}>
        <span className="design-layer-row" style={{ paddingInlineStart: `${(row.level - 1) * 14 + 4}px` }}>
          {row.expandable ? <button type="button" tabIndex={-1} className="design-layer-twisty" aria-hidden="true"
            onClick={() => setOpenRow(row, !isOpen(row))}>{isOpen(row) ? "▾" : "▸"}</button> : <span className="design-layer-twisty" />}
          {renaming === id ? <input className="design-layer-name-input" data-testid="design-layer-rename" autoFocus defaultValue={row.node.name ?? ""}
            aria-label={t("layerRename")} placeholder={row.node.id}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === "Escape") { setRenaming(undefined); focusRow(row); }
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={event => {
              const value = event.currentTarget.value.trim();
              setRenaming(undefined);
              change(row, root => updateNodes(root, new Map([[row.node.id, { name: value || undefined }]])));
              focusRow(row);
            }} /> : <span className={`design-layer-name${row.node.visible === false ? " design-layer-hidden" : ""}`}>
            <span className="design-layer-kind">{t(`kind_${row.level === 1 ? "board" : row.node.type}` as keyof typeof designText) ?? row.node.type}</span>
            {name}</span>}
          {editable && <span className="design-layer-actions">
            <button type="button" tabIndex={-1} aria-pressed={row.node.visible === false} data-testid={`design-layer-${row.node.id}-hide`}
              aria-label={(row.node.visible === false ? t("layerShow") : t("layerHide")).replace("{name}", name)}
              onClick={() => toggle(row, "visible")}>{row.node.visible === false ? "◌" : "●"}</button>
            <button type="button" tabIndex={-1} aria-pressed={!!row.node.locked} data-testid={`design-layer-${row.node.id}-lock`}
              aria-label={(row.node.locked ? t("layerUnlock") : t("layerLock")).replace("{name}", name)}
              onClick={() => toggle(row, "locked")}>{row.node.locked ? "🔒" : "🔓"}</button>
          </span>}
        </span>
      </li>;
    })}
  </ul>;
}
