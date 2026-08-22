import { useEffect, useRef, useState } from "react";
import type { DocumentNavigationNode } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Button,
  isTextDropItem,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Tree,
  TreeItem,
  TreeItemContent,
  useDragAndDrop,
  type Key,
  type Selection,
  type DropPosition
} from "react-aria-components";
import { Icon } from "../shared/icon.js";
import { KindIcon } from "../shared/kind-icon.js";
import styles from "./document-tree.module.css";

function itemKey(node: DocumentNavigationNode): string {
  return node.kind === "folder" ? `folder:${node.path}` : `page:${node.name}`;
}

function allFolderKeys(nodes: DocumentNavigationNode[]): Key[] {
  return nodes.flatMap((node) =>
    node.kind === "folder"
      ? [itemKey(node), ...allFolderKeys(node.children)]
      : []
  );
}

function findNode(
  nodes: DocumentNavigationNode[],
  key: string
): DocumentNavigationNode | undefined {
  for (const node of nodes) {
    if (itemKey(node) === key) return node;
    if (node.kind === "folder") {
      const nested = findNode(node.children, key);
      if (nested) return nested;
    }
  }
  return undefined;
}

function renderNode(
  node: DocumentNavigationNode,
  onSelect: (name: string) => void,
  onSelectFolder: (path: string) => void,
  onCreate: (kind: string, parentPath: string) => void,
  createOptions: Array<{ id: string; label: string }>,
  onItemAction: (
    action: "edit" | "move" | "archive",
    itemKey: string
  ) => void,
  canManage: boolean,
  t: TFunction
) {
  const id = itemKey(node);
  if (node.kind === "page") {
    return (
      <TreeItem
        id={id}
        key={id}
        textValue={node.title}
        className={styles.item}
        onAction={() => onSelect(node.name)}
      >
        <TreeItemContent>
          {({ level }) => (
            <div
              className={styles.row}
              style={{ "--tree-level": level } as React.CSSProperties}
            >
              <span className={styles.pageIcon}>
                <KindIcon resourceKind={node.resourceKind} size={15} />
              </span>
              <span className={styles.label}>{node.title}</span>
              {canManage && (
              <MenuTrigger>
                <Button
                  className={styles.itemAction}
                  aria-label={t("tree.itemActions", { title: node.title })}
                >
                  …
                </Button>
                <Popover className={styles.menuPopover}>
                  <Menu
                    className={styles.menu}
                    aria-label={t("tree.itemActions", { title: node.title })}
                    onAction={(key) =>
                      onItemAction(
                        key as "move" | "archive",
                        id
                      )
                    }
                  >
                    <MenuItem id="move" className={styles.menuItem}>
                      {t("tree.move")}
                    </MenuItem>
                    <MenuItem id="archive" className={styles.dangerItem}>
                      {t("tree.archive")}
                    </MenuItem>
                  </Menu>
                </Popover>
              </MenuTrigger>
              )}
            </div>
          )}
        </TreeItemContent>
      </TreeItem>
    );
  }

  return (
    <TreeItem
      id={id}
      key={id}
      textValue={node.title}
      className={styles.item}
      onAction={() => onSelectFolder(node.path)}
    >
      <TreeItemContent>
        {({ isExpanded, level }) => (
          <div
            className={styles.row}
            style={{ "--tree-level": level } as React.CSSProperties}
          >
            <Button
              slot="chevron"
              className={styles.chevron}
              aria-label={
                isExpanded
                  ? t("tree.closeFolder", { title: node.title })
                  : t("tree.openFolder", { title: node.title })
              }
            >
              <Icon name={isExpanded ? "chevronDown" : "chevronRight"} size={14} />
              <span className="visually-hidden">
                {isExpanded
                  ? t("nav.closeDocumentNav")
                  : t("nav.openDocumentNav")}
              </span>
            </Button>
            <span className={styles.folderIcon}>
              <Icon name={isExpanded ? "folderOpen" : "folder"} size={15} />
            </span>
            <span className={styles.label}>{node.title}</span>
            {canManage && (
            <MenuTrigger>
              <Button
                className={styles.itemAction}
                aria-label={t("tree.createIn", { title: node.title })}
              >
                <Icon name="create" size={14} />
              </Button>
              <Popover className={styles.menuPopover}>
                <Menu
                  className={styles.menu}
                  aria-label={t("tree.createIn", { title: node.title })}
                  onAction={(key) => onCreate(String(key), node.path)}
                >
                  <MenuItem id="page" className={styles.menuItem}>
                    {t("nav.page")}
                  </MenuItem>
                  <MenuItem id="folder" className={styles.menuItem}>
                    {t("nav.folder")}
                  </MenuItem>
                  {/* プラグインが「文書階層へ置く」と宣言したものを同じ場所へ並べる。 */}
                  {createOptions.map((option) => (
                    <MenuItem key={option.id} id={option.id} className={styles.menuItem}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Menu>
              </Popover>
            </MenuTrigger>
            )}
            {canManage && (
            <MenuTrigger>
              <Button
                className={styles.itemAction}
                aria-label={t("tree.itemActions", { title: node.title })}
              >
                …
              </Button>
              <Popover className={styles.menuPopover}>
                <Menu
                  className={styles.menu}
                  aria-label={t("tree.itemActions", { title: node.title })}
                  onAction={(key) =>
                    onItemAction(
                      key as "edit" | "move" | "archive",
                      id
                    )
                  }
                >
                  <MenuItem id="edit" className={styles.menuItem}>
                    {t("tree.editDisplayInfo")}
                  </MenuItem>
                  <MenuItem id="move" className={styles.menuItem}>
                    {t("tree.move")}
                  </MenuItem>
                  <MenuItem id="archive" className={styles.dangerItem}>
                    {t("tree.archive")}
                  </MenuItem>
                </Menu>
              </Popover>
            </MenuTrigger>
            )}
          </div>
        )}
      </TreeItemContent>
      {node.children.map((child) =>
        renderNode(
          child,
          onSelect,
          onSelectFolder,
          onCreate,
          createOptions,
          onItemAction,
          canManage,
          t
        )
      )}
    </TreeItem>
  );
}

export function DocumentTree(props: {
  nodes: DocumentNavigationNode[];
  selected?: string;
  selectedFolder?: string;
  onSelect(name: string): void;
  onSelectFolder(path: string): void;
  onCreate(kind: string, parentPath: string): void;
  /** プラグインが文書ツリーの追加メニューへ出すもの */
  createOptions?: Array<{ id: string; label: string }>;
  onItemAction(
    action: "edit" | "move" | "archive",
    itemKey: string
  ): void;
  onMoveItem?(
    sourceKey: string,
    targetKey: string,
    position: DropPosition
  ): void;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  // 常時全展開だと大きなツリーを見渡せないため、展開状態を制御して一括展開／
  // 折りたたみを可能にする。初回に文書が読み込まれた時点で全展開する。
  const folderKeys = allFolderKeys(props.nodes);
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(
    () => new Set(folderKeys)
  );
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && folderKeys.length > 0) {
      initialized.current = true;
      setExpandedKeys(new Set(folderKeys));
    }
  }, [folderKeys]);
  const selectedKeys = new Set<Key>(
    props.selected
      ? [`page:${props.selected}`]
      : props.selectedFolder
        ? [`folder:${props.selectedFolder}`]
        : []
  );

  function handleSelectionChange(selection: Selection) {
    if (selection === "all") return;
    const key = [...selection][0];
    if (typeof key !== "string") return;
    if (key.startsWith("page:")) props.onSelect(key.slice("page:".length));
    if (key.startsWith("folder:")) {
      props.onSelectFolder(key.slice("folder:".length));
    }
  }
  const { dragAndDropHooks } = useDragAndDrop<DocumentNavigationNode>({
    isDisabled: !props.onMoveItem,
    getItems(keys) {
      return [...keys].map((key) => {
        const node = findNode(props.nodes, String(key));
        return {
          "application/x-vellym-item": String(key),
          "text/plain": node?.title ?? String(key)
        };
      });
    },
    acceptedDragTypes: ["application/x-vellym-item"],
    getDropOperation(target) {
      if (
        target.type === "item" &&
        target.dropPosition === "on" &&
        String(target.key).startsWith("page:")
      ) return "cancel";
      return "move";
    },
    onMove(event) {
      const source = [...event.keys][0];
      if (source === undefined) return;
      props.onMoveItem?.(
        String(source),
        String(event.target.key),
        event.target.dropPosition
      );
    },
    async onRootDrop(event) {
      const item = event.items.find(isTextDropItem);
      if (!item) return;
      const source = await item.getText("application/x-vellym-item");
      props.onMoveItem?.(source, "folder:", "on");
    }
  });

  return (
    <>
      {folderKeys.length > 0 && (
        <div className={styles.treeToolbar}>
          <Button
            className={styles.treeToolbarButton}
            onPress={() => setExpandedKeys(new Set(folderKeys))}
          >
            {t("tree.expandAll")}
          </Button>
          <Button
            className={styles.treeToolbarButton}
            onPress={() => setExpandedKeys(new Set())}
          >
            {t("tree.collapseAll")}
          </Button>
        </div>
      )}
      <Tree
        key={props.nodes.length === 0 ? "empty" : "loaded"}
        aria-label={t("tree.label")}
        className={styles.tree}
        selectionMode="single"
        selectionBehavior="replace"
        selectedKeys={selectedKeys}
        expandedKeys={expandedKeys}
        onExpandedChange={(keys) => setExpandedKeys(new Set(keys))}
        onSelectionChange={handleSelectionChange}
        dragAndDropHooks={dragAndDropHooks}
        renderEmptyState={() => (
          <p className={styles.empty}>{t("tree.empty")}</p>
        )}
      >
        {props.nodes.map((node) =>
          renderNode(
            node,
            props.onSelect,
            props.onSelectFolder,
            props.onCreate,
            props.createOptions ?? [],
            props.onItemAction,
            props.canManage,
            t
          )
        )}
      </Tree>
    </>
  );
}
