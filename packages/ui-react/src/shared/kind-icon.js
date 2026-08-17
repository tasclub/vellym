import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext } from "react";
import { Icon } from "./icon.js";
/**
 * 種別ごとのアイコン。プラグインが渡したものだけが入る。
 *
 * **hostは種別名からアイコンを推測しない。** `TicketTracker`という名前から
 * それらしい絵を選ぶような処理を書くと、Coreがドメインを知ることになる。
 * 渡されなかった種別は、文書と同じ既定の印で出す。
 */
const KindIconContext = createContext({});
export const KindIconProvider = KindIconContext.Provider;
/**
 * 資源の種別に応じたアイコン。
 *
 * 文書ツリーとフォルダ一覧が同じ判断をするための唯一の場所である。
 * 以前は`node.kind === "page"`のif分岐が2箇所に重複していた。
 */
export function KindIcon({ resourceKind, fallback = "page", size = 16, ...rest }) {
    const icons = useContext(KindIconContext);
    const icon = resourceKind ? icons[resourceKind] : undefined;
    if (!icon)
        return _jsx(Icon, { name: fallback, size: size, ...rest });
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: icon.filled ? "currentColor" : "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", ...rest, children: icon.paths.map((d, index) => (_jsx("path", { d: d }, index))) }));
}
//# sourceMappingURL=kind-icon.js.map