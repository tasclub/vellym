import {
  Children,
  createElement,
  isValidElement,
  type MouseEvent,
  type ReactNode
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { headingId, type PageView } from "@vellym-internal/core";
import { Icon } from "./icon.js";

export function DocumentView({
  view,
  headerActions
}: {
  view: PageView;
  headerActions?: ReactNode;
}) {
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
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.set("heading", targetId);
    window.history.replaceState(null, "", `#${params.toString()}`);
  };
  const unknownBlockCount =
    view.page.spec.blocks.length - view.knownBlocks.length;
  return (
    <article className="document">
      <header className="document-header">
        <div className="document-header-main">
          <p className="eyebrow">{view.page.spec.documentType ?? "document"}</p>
          <h1>{view.page.metadata.title}</h1>
        </div>
        {headerActions && (
          <div className="document-header-actions">{headerActions}</div>
        )}
      </header>
      {view.knownBlocks.map((block) => (
        <section className="rich-text" key={block.id} data-block-id={block.id}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: heading(1),
              h2: heading(2),
              h3: heading(3),
              h4: heading(4),
              h5: heading(5),
              h6: heading(6),
              a: ({ children, href }) => {
                // 内部リンク(#page=…)はアプリ内遷移、外部リンクは新規タブで開き、
                // 区別できるよう印を付ける。
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
    </article>
  );
}
