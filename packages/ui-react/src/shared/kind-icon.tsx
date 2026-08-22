import { createContext, useContext, type SVGProps } from "react";
import type { PluginKindIcon } from "@vellym/plugin-api";

import { Icon, type IconName } from "./icon.js";

/**
 * 種別ごとのアイコン。プラグインが渡したものだけが入る。
 *
 * **hostは種別名からアイコンを推測しない。** `TicketTracker`という名前から
 * それらしい絵を選ぶような処理を書くと、Coreがドメインを知ることになる。
 * 渡されなかった種別は、文書と同じ既定の印で出す。
 */
const KindIconContext = createContext<Readonly<Record<string, PluginKindIcon>>>({});

export const KindIconProvider = KindIconContext.Provider;

/**
 * 資源の種別に応じたアイコン。
 *
 * 文書ツリーとフォルダ一覧が同じ判断をするための唯一の場所である。
 * 以前は`node.kind === "page"`のif分岐が2箇所に重複していた。
 */
export function KindIcon({
  resourceKind,
  fallback = "page",
  size = 16,
  ...rest
}: {
  /** 資源の`kind`。`Page`や、プラグインが登録した種別 */
  resourceKind?: string;
  /** 渡されていない種別のときに使う既定の印 */
  fallback?: IconName;
  size?: number;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  const icons = useContext(KindIconContext);
  const icon = resourceKind ? icons[resourceKind] : undefined;
  if (!icon) return <Icon name={fallback} size={size} {...rest} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={icon.filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {/*
        **`d`属性の文字列だけを描く。** SVGの断片を受け取って差し込む形に
        しないため、任意のmarkupがhostのDOMへ入る口が開かない。
      */}
      {icon.paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
