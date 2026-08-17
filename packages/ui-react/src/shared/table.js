import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "./table.module.css";
const DIRECTION_MARK = {
    ascending: "↑",
    descending: "↓",
    none: ""
};
/**
 * 表。**並べ替え、`aria-sort`、横スクロール、選択列をこの中に持つ。**
 *
 * 中身の描き方は呼ぶ側が`cell`で決める。表の作法を各画面へ写さないための
 * 部品であり、クラス名を共有するだけの関係を置き換える。
 *
 * 字の大きさと余白は面（`.paper` / `.chrome` / `.dense`）から継承する。
 * 部品側に「詰めて描く」ような指定を持たせない。
 */
export function DataTable(props) {
    const { selection } = props;
    return (_jsx("div", { className: styles.scroll, children: _jsxs("table", { className: styles.table, children: [props.caption ? (_jsx("caption", { className: "visually-hidden", children: props.caption })) : null, _jsx("thead", { children: _jsxs("tr", { children: [selection ? (_jsx("th", { scope: "col", className: styles.selectCell, children: _jsx("input", { type: "checkbox", checked: selection.allSelected, "aria-label": selection.selectAllLabel, onChange: (event) => selection.onToggleAll(event.target.checked) }) })) : null, props.columns.map((column) => {
                                const label = column.labelHidden ? (_jsx("span", { className: "visually-hidden", children: column.label })) : (column.label);
                                if (!column.onSort) {
                                    return (_jsx("th", { scope: "col", children: label }, column.id));
                                }
                                const direction = column.sort ?? "none";
                                return (_jsx("th", { scope: "col", "aria-sort": direction, children: _jsxs("button", { type: "button", className: styles.sort, onClick: column.onSort, children: [label, direction === "none" ? null : (_jsx("span", { className: styles.direction, "aria-hidden": "true", children: DIRECTION_MARK[direction] }))] }) }, column.id));
                            })] }) }), _jsx("tbody", { children: props.rows.map((row, index) => (_jsxs("tr", { children: [selection ? (_jsx("td", { className: styles.selectCell, children: _jsx("input", { type: "checkbox", checked: selection.isSelected(row), "aria-label": selection.rowLabel(row), onChange: (event) => selection.onToggleRow(row, event.target.checked) }) })) : null, props.columns.map((column) => (_jsx("td", { children: column.cell(row, index) }, column.id)))] }, props.rowKey(row, index)))) })] }) }));
}
//# sourceMappingURL=table.js.map