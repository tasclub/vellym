import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  DocumentHeading,
  DocumentNavigation,
  DocumentNavigationFolder,
  DocumentNavigationPage,
  FolderSummary,
  PageSummary
} from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Tooltip,
  TooltipTrigger,
  type DropPosition
} from "react-aria-components";
import { Icon } from "./icon.js";
import { DocumentTree } from "./document-tree.js";
import { DocumentOutline } from "./document-outline.js";
import type {
  StructureApplyResult,
  StructurePlan
} from "./api.js";
import { SearchDialog } from "./search-dialog.js";
import {
  StructureActionDialog,
  type StructureAction
} from "./structure-dialog.js";
import styles from "./workspace-shell.module.css";

const DEFAULT_TREE_WIDTH = 268;
const MIN_TREE_WIDTH = 220;
const MAX_TREE_WIDTH = 420;
const TREE_WIDTH_KEY = "vellym.navigation.width";
const TREE_OPEN_KEY = "vellym.navigation.open";

function storedTreeWidth(): number {
  const value = Number(window.localStorage.getItem(TREE_WIDTH_KEY));
  return Number.isFinite(value)
    ? Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, value))
    : DEFAULT_TREE_WIDTH;
}

function storedTreeOpen(): boolean {
  return window.localStorage.getItem(TREE_OPEN_KEY) !== "false";
}

// アイコンのみのボタンは意味が伝わりにくいので、ホバー／フォーカスでラベルを出す
// tooltipを添えて発見性を上げる。aria-labelは各ボタン側に既にある。
function IconTooltip(props: { label: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={400}>
      {props.children}
      <Tooltip className={styles.tooltip} offset={6}>
        {props.label}
      </Tooltip>
    </TooltipTrigger>
  );
}

function Breadcrumbs(props: {
  page?: DocumentNavigationPage;
  folders: FolderSummary[];
  onSelectFolder(path: string): void;
}) {
  const { t } = useTranslation();
  const { page } = props;
  if (!page) return <div className={styles.breadcrumbPlaceholder} />;
  if (page.breadcrumbs.length === 0) {
    return <div className={styles.breadcrumbPlaceholder} />;
  }
  return (
    <nav className={styles.breadcrumbs} aria-label={t("nav.breadcrumb")}>
      <ol>
        <li><button type="button" onClick={() => props.onSelectFolder("")}>{t("nav.allDocuments")}</button></li>
        {page.breadcrumbs.map((item, index) => (
          <li key={`${item}:${index}`}>
            <button
              type="button"
              onClick={() => props.onSelectFolder(page.breadcrumbs.slice(0, index + 1).join("/"))}
            >
              {props.folders.find((folder) =>
                folder.path === page.breadcrumbs.slice(0, index + 1).join("/")
              )?.title ?? item}
            </button>
          </li>
        ))}
        <li aria-current="page">{page.title}</li>
      </ol>
    </nav>
  );
}

export function WorkspaceShell(props: {
  navigation: DocumentNavigation;
  pages: PageSummary[];
  folders: FolderSummary[];
  selected?: string;
  selectedFolder?: string;
  area: "documents" | "settings";
  diagnosticCount: number;
  headings: DocumentHeading[];
  structureAvailable: boolean;
  canSearch: boolean;
  canManage: boolean;
  canConfigure: boolean;
  uiLocale: string;
  currentLocale: string;
  onSelect(name: string): void;
  onSelectFolder(path: string): void;
  onAreaChange(area: "documents" | "settings"): void;
  onNavigate(name: string, headingId?: string): void;
  onHeadingSelect(id: string): void;
  onMoveTreeItem(
    sourceKey: string,
    targetKey: string,
    position: DropPosition
  ): void;
  onStructureApplied(
    plan: StructurePlan,
    result: StructureApplyResult
  ): void;
  onFolderApplied(folder: FolderSummary): void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [treeOpen, setTreeOpen] = useState(storedTreeOpen);
  const [treeWidth, setTreeWidth] = useState(storedTreeWidth);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [structureAction, setStructureAction] = useState<StructureAction>();
  const dragStart = useRef<{ x: number; width: number } | undefined>(undefined);
  const selectedPage = useMemo(
    () => props.navigation.pages.find((page) => page.name === props.selected),
    [props.navigation.pages, props.selected]
  );
  const selectedFolder = props.selectedFolder === ""
    ? {
        kind: "folder" as const,
        name: "",
        title: t("nav.allDocuments"),
        path: "",
        children: props.navigation.tree
      }
    : props.navigation.tree
    .flatMap(function collect(node): DocumentNavigationFolder[] {
      return node.kind === "folder"
        ? [node, ...node.children.flatMap(collect)]
        : [];
    })
    .find((folder) => folder.path === props.selectedFolder);
  const contextualParent =
    selectedFolder?.path ?? selectedPage?.breadcrumbs.join("/") ?? "";

  useEffect(() => {
    window.localStorage.setItem(TREE_OPEN_KEY, String(treeOpen));
  }, [treeOpen]);

  useEffect(() => {
    window.localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth));
  }, [treeWidth]);

  useEffect(() => {
    if (!props.canSearch) return;
    function openSearch(event: KeyboardEvent) {
      const target = event.target;
      const isInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (
        (event.key === "/" && !isInput) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [props.canSearch]);

  function selectFromDrawer(name: string) {
    props.onSelect(name);
    setDrawerOpen(false);
  }

  function resizeBy(delta: number) {
    setTreeWidth((current) =>
      Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, current + delta))
    );
  }

  function itemAction(
    action: "edit" | "move" | "archive",
    itemKey: string
  ) {
    if (itemKey.startsWith("page:")) {
      const pageId = itemKey.slice("page:".length);
      if (action === "move") setStructureAction({ type: "move-page", pageId });
      if (action === "archive") {
        setStructureAction({ type: "archive-page", pageId });
      }
      return;
    }
    const folderPath = itemKey.slice("folder:".length);
    if (action === "edit") {
      setStructureAction({ type: "update-folder", folderPath });
    }
    if (action === "move") {
      setStructureAction({ type: "move-folder", folderPath });
    }
    if (action === "archive") {
      setStructureAction({ type: "archive-folder", folderPath });
    }
  }

  return (
    <div
      className={`${styles.shell} ${props.area === "settings" ? styles.adminShell : ""}`}
      style={
        {
          "--navigation-width":
            props.area === "documents" && treeOpen ? `${treeWidth}px` : "0px"
        } as React.CSSProperties
      }
    >
      <a className={styles.skipLink} href="#document-content">
        {t("nav.skipToContent")}
      </a>
      <aside className={styles.productRail} aria-label={t("nav.productRail")}>
        <div className={styles.productMark} aria-hidden="true">V</div>
        <IconTooltip label={t("nav.documents")}>
          <Button
            className={styles.railButton}
            aria-label={t("nav.documents")}
            aria-pressed={props.area === "documents"}
            onPress={() => props.onAreaChange("documents")}
          ><Icon name="documents" size={20} /></Button>
        </IconTooltip>
        {props.canConfigure && (
          <IconTooltip label={t("nav.settings")}>
            <Button
              className={styles.railButton}
              aria-label={`${t("nav.settings")}${props.diagnosticCount ? t("nav.diagnosticsSuffix", { count: props.diagnosticCount }) : ""}`}
              aria-pressed={props.area === "settings"}
              onPress={() => props.onAreaChange("settings")}
            ><Icon name="settings" size={20} /></Button>
          </IconTooltip>
        )}
      </aside>
      <header className={styles.header}>
        <div className={styles.headerLeading}>
          <Button
            className={styles.mobileMenu}
            aria-label={t("nav.openDocumentNav")}
            onPress={() => setDrawerOpen(true)}
          >
            <Icon name="menu" size={18} />
          </Button>
          {props.canConfigure && (
            <Button
              className={styles.mobileSettings}
              aria-label={
                props.area === "settings"
                  ? t("nav.documents")
                  : t("nav.settings")
              }
              onPress={() =>
                props.onAreaChange(props.area === "settings" ? "documents" : "settings")
              }
            ><Icon name={props.area === "settings" ? "documents" : "settings"} size={18} /></Button>
          )}
          <IconTooltip
            label={
              treeOpen
                ? t("nav.closeDocumentNav")
                : t("nav.openDocumentNav")
            }
          >
            <Button
              className={styles.desktopToggle}
              aria-label={
                treeOpen
                  ? t("nav.closeDocumentNav")
                  : t("nav.openDocumentNav")
              }
              onPress={() => setTreeOpen((current) => !current)}
            >
              <Icon name={treeOpen ? "chevronLeft" : "chevronRight"} size={18} />
            </Button>
          </IconTooltip>
          <div>
            <strong>Vellym</strong>
            <span>{t("product.workspace")}</span>
          </div>
        </div>
        {props.canSearch && (
          <Button
            className={styles.searchButton}
            aria-label={t("search.openFullText")}
            onPress={() => setSearchOpen(true)}
          >
            <Icon name="search" size={16} />
            <span className={styles.searchLabel}>
              {t("search.open")}
            </span>
            <kbd>⌘ K</kbd>
          </Button>
        )}
      </header>
      {props.area === "documents" && <aside
        className={styles.navigation}
        aria-label={t("nav.documentNav")}
        aria-hidden={!treeOpen}
      >
        <div className={styles.navigationHeader}>
          <h2>{t("nav.documents")}</h2>
          <div>
            <span>{props.navigation.pages.length}</span>
            {props.canManage && (
            <MenuTrigger>
              <Button
                className={styles.manageButton}
                isDisabled={!props.structureAvailable}
                aria-label={t("nav.create")}
              >
                <Icon name="create" size={16} />
              </Button>
              <Popover className={styles.createPopover}>
                <Menu
                  className={styles.createMenu}
                  aria-label={t("nav.create")}
                  onAction={(key) =>
                    setStructureAction({
                      type: key === "page" ? "create-page" : "create-folder",
                      parentPath: contextualParent,
                      chooseParent: true
                    })
                  }
                >
                  <MenuItem id="page" className={styles.createMenuItem}>
                    {t("nav.page")}
                  </MenuItem>
                  <MenuItem id="folder" className={styles.createMenuItem}>
                    {t("nav.folder")}
                  </MenuItem>
                </Menu>
              </Popover>
            </MenuTrigger>
            )}
          </div>
        </div>
        <DocumentTree
          nodes={props.navigation.tree}
          selected={props.selected}
          selectedFolder={props.selectedFolder}
          canManage={props.canManage}
          onSelect={props.onSelect}
          onSelectFolder={props.onSelectFolder}
          onCreate={(kind, parentPath) =>
            setStructureAction({
              type: kind === "page" ? "create-page" : "create-folder",
              parentPath
            })
          }
          onItemAction={itemAction}
          onMoveItem={
            props.structureAvailable ? props.onMoveTreeItem : undefined
          }
        />
      </aside>}
      {props.area === "documents" && treeOpen && (
        <div
          className={styles.resizeHandle}
          role="separator"
          aria-label={t("nav.documentNavWidth")}
          aria-orientation="vertical"
          aria-valuemin={MIN_TREE_WIDTH}
          aria-valuemax={MAX_TREE_WIDTH}
          aria-valuenow={treeWidth}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              resizeBy(-12);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              resizeBy(12);
            }
          }}
          onPointerDown={(event) => {
            dragStart.current = { x: event.clientX, width: treeWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = dragStart.current;
            if (!start) return;
            setTreeWidth(
              Math.min(
                MAX_TREE_WIDTH,
                Math.max(MIN_TREE_WIDTH, start.width + event.clientX - start.x)
              )
            );
          }}
          onPointerUp={(event) => {
            dragStart.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
      )}
      <div className={styles.contentColumn}>
        {props.area === "documents" ? (
          selectedFolder ? (
            selectedFolder.path ? <nav className={styles.breadcrumbs} aria-label={t("nav.breadcrumb")}>
              <ol>
                <li><button type="button" onClick={() => props.onSelectFolder("")}>{t("nav.allDocuments")}</button></li>
                {selectedFolder.path.split("/").map((item, index, all) => (
                  <li key={`${item}:${index}`} aria-current={index === all.length - 1 ? "page" : undefined}>
                    {index === all.length - 1 ? selectedFolder.title : (
                      <button
                        type="button"
                        onClick={() => props.onSelectFolder(all.slice(0, index + 1).join("/"))}
                      >
                        {props.folders.find((folder) =>
                          folder.path === all.slice(0, index + 1).join("/")
                        )?.title ?? item}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </nav> : <div className={styles.breadcrumbPlaceholder} />
          ) : <Breadcrumbs
            page={selectedPage}
            folders={props.folders}
            onSelectFolder={props.onSelectFolder}
          />
        ) : <div className={styles.breadcrumbPlaceholder} />}
        {props.area === "documents" && <DocumentOutline
          compact
          headings={props.headings}
          pageId={props.selected}
          onSelect={props.onHeadingSelect}
        />}
        <main id="document-content" className={styles.content} tabIndex={-1}>
          {props.children}
          {props.area === "documents" && selectedPage && !props.selectedFolder && (
            <nav className={styles.pageTurner} aria-label={t("nav.previousDocuments")}>
              {selectedPage.previous ? (
                <button type="button" onClick={() => props.onNavigate(selectedPage.previous!.name)}>
                  <small>{t("nav.previous")}</small><strong>← {selectedPage.previous.title}</strong>
                </button>
              ) : <span />}
              {selectedPage.next ? (
                <button type="button" onClick={() => props.onNavigate(selectedPage.next!.name)}>
                  <small>{t("nav.next")}</small><strong>{selectedPage.next.title} →</strong>
                </button>
              ) : <span />}
            </nav>
          )}
        </main>
      </div>
      {props.area === "documents" && <aside className={styles.outlineColumn}>
        <DocumentOutline
          headings={props.headings}
          pageId={props.selected}
          onSelect={props.onHeadingSelect}
        />
      </aside>}
      <ModalOverlay
        className={styles.overlay}
        isOpen={drawerOpen}
        onOpenChange={setDrawerOpen}
        isDismissable
      >
        <Modal className={styles.drawer}>
          <Dialog aria-label={t("nav.documentNav")} className={styles.dialog}>
            <div className={styles.drawerHeader}>
              <h2>{t("nav.documents")}</h2>
              <Button
                className={styles.closeButton}
                aria-label={t("nav.closeDocumentNav")}
                onPress={() => setDrawerOpen(false)}
              >
                <Icon name="close" size={18} />
              </Button>
            </div>
            <DocumentTree
              nodes={props.navigation.tree}
              selected={props.selected}
              selectedFolder={props.selectedFolder}
              canManage={props.canManage}
              onSelect={selectFromDrawer}
              onSelectFolder={(path) => {
                props.onSelectFolder(path);
                setDrawerOpen(false);
              }}
              onCreate={(kind, parentPath) => {
                setDrawerOpen(false);
                setStructureAction({
                  type: kind === "page" ? "create-page" : "create-folder",
                  parentPath
                });
              }}
              onItemAction={(action, itemKey) => {
                setDrawerOpen(false);
                itemAction(action, itemKey);
              }}
              onMoveItem={
                props.structureAvailable ? props.onMoveTreeItem : undefined
              }
            />
          </Dialog>
        </Modal>
      </ModalOverlay>
      {props.canSearch && (
        <SearchDialog
          isOpen={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={props.onNavigate}
          locale={props.currentLocale}
        />
      )}
      <StructureActionDialog
        action={structureAction}
        pages={props.pages}
        folders={props.folders}
        uiLocale={props.uiLocale}
        onOpenChange={(open) => {
          if (!open) setStructureAction(undefined);
        }}
        onApplied={props.onStructureApplied}
        onFolderApplied={props.onFolderApplied}
      />
    </div>
  );
}
