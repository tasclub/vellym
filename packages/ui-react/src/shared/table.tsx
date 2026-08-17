import type { ReactNode } from "react";

import styles from "./table.module.css";

export type SortDirection = "ascending" | "descending" | "none";

export interface DataTableColumn<Row> {
  id: string;
  label: ReactNode;
  /**
   * 見出しを目に見せないが読み上げには載せる。操作だけの列に使う。
   * **見出しごと省かない。** 列の意味が読み上げから消える。
   */
  labelHidden?: boolean;
  /**
   * 並び順。**宣言したときだけ**並べ替えの導線が出る。
   * hostが「選択肢のある列なら並べ替えられる」と推測しない。
   */
  sort?: SortDirection;
  onSort?(): void;
  cell(row: Row, index: number): ReactNode;
}

export interface DataTableSelection<Row> {
  /** 見出しのチェックボックスの読み上げ名 */
  selectAllLabel: string;
  allSelected: boolean;
  isSelected(row: Row): boolean;
  /** 行のチェックボックスの読み上げ名。行の題名を渡す */
  rowLabel(row: Row): string;
  onToggleRow(row: Row, selected: boolean): void;
  onToggleAll(selected: boolean): void;
}

const DIRECTION_MARK: Record<SortDirection, string> = {
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
export function DataTable<Row>(props: {
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  rowKey(row: Row, index: number): string;
  selection?: DataTableSelection<Row>;
  /** 表の目的。読み上げ利用者が表へ入った時点で分かるようにする */
  caption?: string;
}) {
  const { selection } = props;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        {props.caption ? (
          <caption className="visually-hidden">{props.caption}</caption>
        ) : null}
        <thead>
          <tr>
            {selection ? (
              <th scope="col" className={styles.selectCell}>
                <input
                  type="checkbox"
                  checked={selection.allSelected}
                  aria-label={selection.selectAllLabel}
                  onChange={(event) => selection.onToggleAll(event.target.checked)}
                />
              </th>
            ) : null}
            {props.columns.map((column) => {
              const label = column.labelHidden ? (
                <span className="visually-hidden">{column.label}</span>
              ) : (
                column.label
              );
              if (!column.onSort) {
                return (
                  <th key={column.id} scope="col">
                    {label}
                  </th>
                );
              }
              const direction = column.sort ?? "none";
              return (
                <th key={column.id} scope="col" aria-sort={direction}>
                  <button type="button" className={styles.sort} onClick={column.onSort}>
                    {label}
                    {direction === "none" ? null : (
                      <span className={styles.direction} aria-hidden="true">
                        {DIRECTION_MARK[direction]}
                      </span>
                    )}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={props.rowKey(row, index)}>
              {selection ? (
                <td className={styles.selectCell}>
                  <input
                    type="checkbox"
                    checked={selection.isSelected(row)}
                    aria-label={selection.rowLabel(row)}
                    onChange={(event) => selection.onToggleRow(row, event.target.checked)}
                  />
                </td>
              ) : null}
              {props.columns.map((column) => (
                <td key={column.id}>{column.cell(row, index)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
