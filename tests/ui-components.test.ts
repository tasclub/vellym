import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "../packages/ui-react/src/shared/table.js";
import { Button } from "../packages/ui-react/src/shared/button.js";
import {
  KindIcon,
  KindIconProvider
} from "../packages/ui-react/src/shared/kind-icon.js";
import { buildDocumentNavigation } from "@vellym-internal/core";

interface Row {
  name: string;
  title: string;
}

const rows: Row[] = [
  { name: "ticket-a", title: "描画契約をmountへ確定する" },
  { name: "ticket-b", title: "共通部品の層を作る" }
];

function table(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(DataTable<Row>, {
      rows,
      rowKey: (row) => row.name,
      columns: [{ id: "title", label: "タイトル", cell: (row) => row.title }],
      ...props
    })
  );
}

describe("DataTable", () => {
  it("declares the sort direction so it is announced, not only shown", () => {
    // 並び順を色や太さだけで示すと読み上げに載らない。aria-sortと記号の両方を出す。
    const html = table({
      columns: [
        {
          id: "title",
          label: "タイトル",
          sort: "ascending",
          onSort: () => undefined,
          cell: (row) => row.title
        }
      ]
    });
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("↑");
    expect(html).toContain("<button");
  });

  it("does not offer sorting for columns that did not declare it", () => {
    // hostが「並べ替えられそうな列」を推測しない。宣言した列だけに導線を出す。
    const html = table();
    expect(html).not.toContain("aria-sort");
    expect(html).not.toContain("<button");
  });

  it("gives every checkbox its own name", () => {
    // 「選択」だけが並ぶと、読み上げでどの行か分からなくなる。
    const html = table({
      selection: {
        selectAllLabel: "すべて選択",
        allSelected: false,
        isSelected: (row) => row.name === "ticket-a",
        rowLabel: (row) => row.title,
        onToggleRow: () => undefined,
        onToggleAll: () => undefined
      }
    });
    expect(html).toContain('aria-label="すべて選択"');
    expect(html).toContain('aria-label="描画契約をmountへ確定する"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  });

  it("keeps a hidden column heading readable instead of dropping it", () => {
    // 操作だけの列でも見出しを省かない。列の意味が読み上げから消える。
    const html = table({
      columns: [
        { id: "actions", label: "行の操作", labelHidden: true, cell: () => "…" }
      ]
    });
    expect(html).toContain("visually-hidden");
    expect(html).toContain("行の操作");
  });

  it("names the table for anyone who lands inside it", () => {
    expect(table({ caption: "チケット" })).toContain("<caption");
  });
});

describe("Button", () => {
  it("defaults to type=button so a stray button cannot submit a form", () => {
    expect(renderToStaticMarkup(createElement(Button, {}, "作成"))).toContain(
      'type="button"'
    );
  });

  it("still allows an explicit submit", () => {
    expect(
      renderToStaticMarkup(createElement(Button, { type: "submit" }, "保存"))
    ).toContain('type="submit"');
  });
});

describe("KindIcon", () => {
  const icons = {
    TicketTracker: { paths: ["M1 1h4", "M1 4h2"] }
  };

  function render(resourceKind?: string): string {
    return renderToStaticMarkup(
      createElement(
        KindIconProvider,
        { value: icons },
        createElement(KindIcon, { resourceKind })
      )
    );
  }

  it("draws what the plugin declared", () => {
    const html = render("TicketTracker");
    expect(html).toContain('d="M1 1h4"');
    expect(html).toContain('d="M1 4h2"');
  });

  it("falls back instead of breaking when a kind declared nothing", () => {
    // アイコンを渡さないプラグインでも壊れない。既定の印で出る。
    expect(render("Unknown")).toContain("<svg");
    expect(render(undefined)).toContain("<svg");
  });

  it("never guesses an icon from the kind name", () => {
    // 種別名からそれらしい絵を選ぶと、Coreがドメインを知ることになる。
    // 登録の無い `Ticket` は、`TicketTracker` の絵を借りない。
    expect(render("Ticket")).not.toContain('d="M1 1h4"');
  });

  it("stays a decoration for assistive technology", () => {
    // 名前は隣の文字が持つ。アイコン自体は読み上げに載せない。
    expect(render("TicketTracker")).toContain('aria-hidden="true"');
  });
});

describe("document navigation", () => {
  it("carries the resource kind to the tree so icons can be resolved", () => {
    const navigation = buildDocumentNavigation([
      {
        name: "work",
        title: "作業",
        relativePath: "work.yaml",
        readOnly: false,
        resourceKind: "TicketTracker"
      },
      {
        name: "readme",
        title: "はじめに",
        relativePath: "readme.yaml",
        readOnly: false,
        resourceKind: "Page"
      }
    ]);
    const kinds = navigation.tree
      .filter((node) => node.kind === "page")
      .map((node) => (node.kind === "page" ? node.resourceKind : undefined));
    expect(kinds.sort()).toEqual(["Page", "TicketTracker"]);
  });
});
