import {
  Children,
  createElement,
  isValidElement,
  useMemo,
  type MouseEvent,
  type ReactNode
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import {
  headingId,
  transformWikiLinks,
  type PageReferenceView,
  type PageView,
  type WikiLinkParts,
  type WikiLinkResolution
} from "@vellym-internal/core";
import { Icon } from "../shared/icon.js";
import {
  documentPagePath,
  localeDirection,
  resolveDocumentLocation,
  staticAppBasePath
} from "../shell/routing.js";

function referenceLookupKey(parts: Pick<WikiLinkParts, "target" | "heading">): string {
  return `${parts.target}\u0000${parts.heading ?? ""}`;
}

export function DocumentView({
  view,
  headerActions,
  beforeBody,
  onNavigatePage
}: {
  view: PageView;
  headerActions?: ReactNode;
  /**
   * 見出しと本文の間に差し込む内容。プラグインが宣言した項目をここへ置く。
   * 本文の描画と保存経路はそのまま使い、専用の画面を作らない。
   */
  beforeBody?: ReactNode;
  onNavigatePage?(pageId: string, heading?: string): void;
}) {
  const locale = view.locale ?? view.baseLocale;
  // 本文の`[[...]]`は、サーバ／静的builderが解決した結果（view.relations.outgoing）
  // を使って描画する。readerが独自に解決規則を持たないようにする。
  const remarkWikiLinks = useMemo(() => {
    const resolutions = new Map<string, PageReferenceView>();
    for (const reference of view.relations?.outgoing ?? []) {
      resolutions.set(referenceLookupKey(reference), reference);
    }
    const resolve = (parts: WikiLinkParts): WikiLinkResolution => {
      const reference = resolutions.get(referenceLookupKey(parts));
      if (!reference || reference.status !== "resolved" || !reference.pageId || !locale) {
        return { status: reference?.status ?? "missing-page" };
      }
      return {
        status: "resolved",
        href: documentPagePath(locale, reference.slug ?? reference.pageId, reference.headingId),
        ...(reference.title === undefined ? {} : { title: reference.title }),
        pageId: reference.pageId,
        ...(reference.headingId === undefined ? {} : { headingId: reference.headingId })
      };
    };
    return () => (tree: Root) => transformWikiLinks(tree, resolve);
  }, [locale, view.relations]);
  const headingOccurrences = new Map<string, number>();
  const textContent = (node: ReactNode): string =>
    Children.toArray(node)
      .map((child) => {
        if (typeof child === "string" || typeof child === "number") {
          return String(child);
        }
        return isValidElement<{ children?: ReactNode }>(child)
          ? textContent(child.props.children)
          : "";
      })
      .join("");
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) =>
    function MarkdownHeading({ children }: { children?: ReactNode }) {
      return createElement(
        `h${level}`,
        {
          id: headingId(textContent(children), headingOccurrences),
          tabIndex: -1
        },
        children
      );
    };
  const handleAnchorClick = (
    event: MouseEvent<HTMLAnchorElement>,
    href?: string
  ) => {
    if (!href || !href.startsWith("#")) return;
    const targetId = href.slice(1);
    const target = document.getElementById(targetId);
    if (!target) return;
    // アプリのルーターはwindow.location.hashをページ／見出しのクエリとして扱う
    // （app.tsxのpageHash/locationFromHash参照）。素のアンカー移動はこのhashを
    // 上書きして現在ページを失うため、手動でスクロールし`heading`だけを書き換える。
    event.preventDefault();
    target.scrollIntoView({ block: "start" });
    target.focus({ preventScroll: true });
    const route = resolveDocumentLocation({
      pathname: window.location.pathname,
      hash: window.location.hash,
      basePath: staticAppBasePath(),
      defaultLocale: window.__VELLYM_STATIC__?.defaultLocale
    });
    if (!route.legacy && route.locale && route.page) {
      window.history.replaceState(
        null,
        "",
        documentPagePath(route.locale, route.page, targetId)
      );
    } else {
      const params = new URLSearchParams(window.location.hash.slice(1));
      params.set("heading", targetId);
      window.history.replaceState(null, "", `#${params.toString()}`);
    }
  };
  const unknownBlockCount =
    (view.page.spec.blocks?.length ?? 0) - view.knownBlocks.length;
  const incoming = (view.relations?.incoming ?? []).filter(
    (reference) => reference.pageId !== undefined
  );
  const diagnostics = view.relations?.diagnostics ?? [];
  return (
    <article
      className="document"
      lang={locale}
      dir={localeDirection(locale ?? "en")}
    >
      <header className="document-header">
        <div className="document-header-main">
          <h1>{view.page.metadata.title}</h1>
        </div>
        {headerActions && (
          <div className="document-header-actions">{headerActions}</div>
        )}
      </header>
      {beforeBody}
      {view.knownBlocks.map((block) => (
        <section className="rich-text" key={block.id} data-block-id={block.id}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkWikiLinks]}
            components={{
              h1: heading(1),
              h2: heading(2),
              h3: heading(3),
              h4: heading(4),
              h5: heading(5),
              h6: heading(6),
              a: ({ children, href, ...rest }) => {
                // `[[...]]`由来の内部Pageリンクはremark pluginがdata属性を付ける。
                // それ以外は素のCommonMarkリンク＝同一Page内の見出しアンカー
                // （`#…`）か外部リンクであり、外部は新規タブで開いて印を付ける。
                const attributes = rest as Record<string, string | undefined>;
                const pageId = attributes["data-page-id"];
                if (pageId) {
                  const heading = attributes["data-heading-id"];
                  return (
                    <a
                      href={href}
                      className="internal-link"
                      onClick={(event) => {
                        if (!onNavigatePage) return;
                        event.preventDefault();
                        onNavigatePage(pageId, heading);
                      }}
                    >
                      {children}
                    </a>
                  );
                }
                const external = !!href && !href.startsWith("#");
                return (
                  <a
                    href={href}
                    className={external ? "external-link" : "internal-link"}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noreferrer noopener" : undefined}
                    onClick={(event) => handleAnchorClick(event, href)}
                  >
                    {children}
                    {external && (
                      <span className="external-link-icon" aria-hidden="true">
                        <Icon name="arrowUpRight" size={12} />
                      </span>
                    )}
                  </a>
                );
              },
              // 幅広の表は横スクロールのコンテナに入れ、狭い読み幅でもセルが
              // 潰れて読めなくならないようにする。
              table: ({ children }) => (
                <div className="table-scroll">
                  <table>{children}</table>
                </div>
              )
            }}
          >
            {block.content}
          </ReactMarkdown>
        </section>
      ))}
      {unknownBlockCount > 0 && (
        <aside className="unsupported-content">
          この文書には、この版で表示できない内容があります。
        </aside>
      )}
      {incoming.length > 0 && (
        <aside className="page-backlinks">
          <h2>このPageを参照しているPage</h2>
          <ul>
            {incoming.map((reference) => (
              <li key={reference.pageId}>
                <button
                  type="button"
                  className="backlink"
                  onClick={() => onNavigatePage?.(reference.pageId!)}
                >
                  {reference.title ?? reference.pageId}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
      {diagnostics.length > 0 && (
        <aside className="page-reference-diagnostics">
          <h2>リンクの問題</h2>
          <ul>
            {diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.blockId}:${diagnostic.target}:${diagnostic.code}`}>
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </article>
  );
}
