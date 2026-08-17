import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../shared/icon.js";
import {
  checkState,
  type SetupCatalogIndex,
  type SetupSelectionState,
  type SetupTreeNode
} from "./setup-catalog-tree.js";
import styles from "./setup.module.css";

const REFERENCE_LABELS: Record<string, string> = {
  "iso-12207": "ISO 12207",
  pmbok: "PMBOK",
  "iso-29148": "ISO 29148",
  arc42: "arc42",
  adr: "ADR",
  "c4-model": "C4 Model",
  security: "Security"
};

export function referenceLabel(id: string): string {
  return REFERENCE_LABELS[id] ?? id;
}

function visibleNodes(nodes: SetupTreeNode[], expanded: Set<string>): SetupTreeNode[] {
  return nodes.flatMap((node) =>
    expanded.has(node.id) ? [node, ...visibleNodes(node.children, expanded)] : [node]
  );
}

export function SetupTree(props: {
  index: SetupCatalogIndex;
  nodes: SetupTreeNode[];
  selection: SetupSelectionState;
  expanded: Set<string>;
  label: string;
  language: "ja" | "en";
  readOnly?: boolean;
  reasons?: Record<string, string>;
  /** Rows kept visible for re-selection even though nothing will be created. */
  omittedIds?: Set<string>;
  onToggleExpanded(nodeId: string): void;
  onToggleSelected?(nodeId: string, checked: boolean): void;
  renderDetail?(node: SetupTreeNode): React.ReactNode;
}) {
  const ja = props.language === "ja";
  const flat = visibleNodes(props.nodes, props.expanded);
  const [activeId, setActiveId] = useState<string>();
  const active = flat.some((node) => node.id === activeId) ? activeId : flat[0]?.id;
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    // Roving tabindex: keep DOM focus on the item the user moved to.
    if (!active) return;
    const element = itemRefs.current.get(active);
    if (element && document.activeElement?.closest("[role=tree]") === element.closest("[role=tree]")) {
      if (document.activeElement !== element) element.focus();
    }
  }, [active]);

  function move(offset: number): void {
    const index = flat.findIndex((node) => node.id === active);
    const next = flat[Math.min(Math.max(index + offset, 0), flat.length - 1)];
    if (next) {
      setActiveId(next.id);
      itemRefs.current.get(next.id)?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, node: SetupTreeNode): void {
    const expandable = node.children.length > 0;
    const open = props.expanded.has(node.id);
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); return;
      case "ArrowUp": event.preventDefault(); move(-1); return;
      case "ArrowRight":
        event.preventDefault();
        if (expandable && !open) props.onToggleExpanded(node.id);
        else if (expandable) move(1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (expandable && open) props.onToggleExpanded(node.id);
        else if (node.parentId) {
          setActiveId(node.parentId);
          itemRefs.current.get(node.parentId)?.focus();
        }
        return;
      case "Home": event.preventDefault(); if (flat[0]) { setActiveId(flat[0].id); itemRefs.current.get(flat[0].id)?.focus(); } return;
      case "End": {
        event.preventDefault();
        const last = flat[flat.length - 1];
        if (last) { setActiveId(last.id); itemRefs.current.get(last.id)?.focus(); }
        return;
      }
      case " ":
      case "Enter":
        if (props.readOnly || !props.onToggleSelected) return;
        event.preventDefault();
        props.onToggleSelected(node.id, checkState(props.index, props.selection, node.id) !== "checked");
        return;
      default:
    }
  }

  function render(nodes: SetupTreeNode[], level: number): React.ReactNode {
    return nodes.map((node, position) => {
      const state = checkState(props.index, props.selection, node.id);
      const expandable = node.children.length > 0;
      const open = props.expanded.has(node.id);
      const reason = props.reasons?.[node.id];
      const omitted = props.omittedIds?.has(node.id) ?? false;
      return (
        <li key={node.id} role="none">
          <div
            role="treeitem"
            ref={(element) => {
              if (element) itemRefs.current.set(node.id, element);
              else itemRefs.current.delete(node.id);
            }}
            tabIndex={node.id === active ? 0 : -1}
            aria-level={level}
            aria-posinset={position + 1}
            aria-setsize={nodes.length}
            {...(expandable ? { "aria-expanded": open } : {})}
            {...(props.readOnly
              ? {}
              : { "aria-checked": state === "indeterminate" ? "mixed" : state === "checked" })}
            aria-describedby={reason ? `${node.id}-reason` : undefined}
            className={[styles["setup-tree-item"], styles[node.kind], props.readOnly ? styles["readonly"] : "", omitted ? styles["omitted"] : ""].filter(Boolean).join(" ")}
            onKeyDown={(event) => onKeyDown(event, node)}
            onFocus={() => setActiveId(node.id)}
          >
            {expandable ? (
              <button
                type="button"
                className={styles["setup-tree-twisty"]}
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => props.onToggleExpanded(node.id)}
              >
                <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
              </button>
            ) : (
              <span className={styles["setup-tree-twisty"]} aria-hidden="true" />
            )}
            {!props.readOnly && props.onToggleSelected && (
              <input
                type="checkbox"
                tabIndex={-1}
                checked={state === "checked"}
                ref={(element) => {
                  if (element) element.indeterminate = state === "indeterminate";
                }}
                onChange={(event) => props.onToggleSelected?.(node.id, event.target.checked)}
                aria-label={node.title}
              />
            )}
            <span className={styles["setup-tree-label"]}>
              <span className={styles["setup-tree-title"]}>
                <strong>{node.title}</strong>
                {omitted && (
                  <span className={styles["setup-tree-omitted"]}>
                    {ja ? "作成しません" : "Not created"}
                  </span>
                )}
              </span>
              <small className={styles["setup-tree-description"]}>{node.description}</small>
              {(node.referenceModels.length > 0 || reason) && (
                <small id={reason ? `${node.id}-reason` : undefined} className={styles["setup-tree-meta"]}>
                  {node.referenceModels.length > 0 && (
                    <span>
                      {ja ? "参考: " : "Reference: "}
                      {node.referenceModels.map(referenceLabel).join(ja ? "、" : ", ")}
                    </span>
                  )}
                  {reason && <span>{reason}</span>}
                </small>
              )}
            </span>
          </div>
          {props.renderDetail && state === "checked" ? props.renderDetail(node) : undefined}
          {expandable && open && (
            <ul role="group">{render(node.children, level + 1)}</ul>
          )}
        </li>
      );
    });
  }

  if (!props.nodes.length) {
    return (
      <p className={styles["setup-tree-empty"]}>
        {ja ? "該当するFolder・Pageがありません。" : "No folders or pages match."}
      </p>
    );
  }

  return (
    <ul role="tree" aria-label={props.label} className={styles["setup-tree"]}>
      {render(props.nodes, 1)}
    </ul>
  );
}
