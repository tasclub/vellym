import type {
  Diagnostic,
  PageSummary
} from "@vellym-internal/core";

export function Sidebar(props: {
  pages: PageSummary[];
  diagnostics: Diagnostic[];
  selected?: string;
  onSelect(name: string): void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">D</span>
        <div>
          <strong>Vellym</strong>
          <small>Project documents</small>
        </div>
      </div>
      <nav aria-label="ページ一覧">
        {props.pages.map((page) => (
          <button
            className={props.selected === page.name ? "page-link active" : "page-link"}
            key={page.name}
            onClick={() => props.onSelect(page.name)}
          >
            <span>{page.title}</span>
            <small>{page.relativePath}</small>
          </button>
        ))}
      </nav>
      <div className="diagnostics">
        <strong>診断 {props.diagnostics.length}件</strong>
        {props.diagnostics.slice(0, 5).map((item, index) => (
          <p key={`${item.file}-${item.code}-${index}`}>
            {item.file}: {item.message}
          </p>
        ))}
      </div>
    </aside>
  );
}
