// アプリ全体のアイコンを集約したインラインSVG。OS・フォント依存で表示が崩れないよう
// Unicode記号を使わず、stroke/fillをcurrentColorにしてテーマトークン（--inkなど）へ
// 追従させる。個々のアイコンはaria-labelが別途付く前提の装飾扱いのためaria-hiddenで描く。
import type { SVGProps } from "react";

export type IconName =
  | "page"
  | "folder"
  | "folderOpen"
  | "documents"
  | "settings"
  | "menu"
  | "search"
  | "close"
  | "create"
  | "chevronDown"
  | "chevronRight"
  | "chevronLeft"
  | "check"
  | "arrowUpRight";

// viewBox は 16x16 に統一。線は currentColor・round キャップで軽い線画に揃える。
const PATHS: Record<IconName, React.ReactNode> = {
  page: (
    <>
      <path d="M4 1.75h5L12.25 5v9.25H4z" />
      <path d="M8.75 1.75V5.25h3.5" />
      <path d="M6 8h4M6 10.5h4" />
    </>
  ),
  folder: (
    <path d="M1.75 4.25c0-.55.45-1 1-1h3l1.5 1.75h6c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z" />
  ),
  folderOpen: (
    <>
      <path d="M1.75 4.25c0-.55.45-1 1-1h3l1.5 1.75h6c.55 0 1 .45 1 1v1.25H1.75z" />
      <path d="M1.75 6.5h12.5l-1.4 6.1c-.1.5-.55.9-1 .9H3.15c-.45 0-.9-.4-1-.9z" />
    </>
  ),
  documents: (
    <>
      <path d="M3.5 2.25h6L12.5 5.25v8.5h-9z" />
      <path d="M9.25 2.25V5.5h3.25" />
      <path d="M5.5 8h5M5.5 10.5h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.75v1.5M8 12.75v1.5M2.25 8h1.5M12.25 8h1.5M3.9 3.9l1.05 1.05M11.05 11.05l1.05 1.05M12.1 3.9l-1.05 1.05M4.95 11.05L3.9 12.1" />
    </>
  ),
  menu: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2L13.75 13.75" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  create: <path d="M8 3v10M3 8h10" />,
  chevronDown: <path d="M4 6l4 4 4-4" />,
  chevronRight: <path d="M6 4l4 4-4 4" />,
  chevronLeft: <path d="M10 4l-4 4 4 4" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  arrowUpRight: (
    <>
      <path d="M5 11l6-6" />
      <path d="M6.25 5H11v4.75" />
    </>
  )
};

// fill を使うのは中身を塗る folder / create くらいで、他は線画。個別に指定する。
const FILLED: ReadonlySet<IconName> = new Set<IconName>(["folder"]);

export function Icon({
  name,
  size = 16,
  ...rest
}: { name: IconName; size?: number } & Omit<
  SVGProps<SVGSVGElement>,
  "name"
>) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
