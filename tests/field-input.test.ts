// @vitest-environment jsdom
import { act } from "react";

// Reactへテスト環境であることを伝える。無いとactの警告が出続ける。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginFieldDescriptor } from "@vellym/plugin-api";
import {
  FieldInput,
  toSpecValue,
  type PluginSpecValue
} from "../packages/ui-react/src/shared/field-input.js";

/**
 * **チェックボックスに「未入力」は無い。**
 *
 * 外した状態を空文字で返していたため、`toSpecValue`がnullにし、保存が
 * キーごと消していた。新しく足した真偽値の項目へ偽を入れられず、既にある
 * 偽を外すと行が消える、という2つの壊れ方になっていた。実DOMで確かめる。
 */
const field: PluginFieldDescriptor = {
  id: "create-ai",
  label: "AIが作成した項目",
  type: "boolean",
  path: ["fields", "create-ai"]
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * 真偽値の入力欄を、呼び出し側と同じ「制御された入力」として描く。
 * `onChange`のたびに新しい値で描き直さないと、2回目のクリックが試せない。
 */
function checkbox(initial: string) {
  let current = initial;
  function Controlled() {
    const [value, setValue] = useState(initial);
    current = value;
    return createElement(FieldInput, {
      field,
      id: "field-create-ai",
      value,
      locale: "ja",
      onChange: setValue
    });
  }
  act(() => root.render(createElement(Controlled)));
  return {
    click() {
      const box = host.querySelector<HTMLInputElement>("input[type=checkbox]");
      if (!box) throw new Error("チェックボックスが描かれていない");
      act(() => box.click());
    },
    /** いま保存へ渡る値。nullはキーごと消すことを意味する */
    saved(): PluginSpecValue {
      return toSpecValue(field, current);
    }
  };
}

describe("FieldInput の真偽値", () => {
  it("未設定の項目を入れて外すと、キー削除ではなく偽を書く", () => {
    // 索引行に値が無い（後から定義へ足した）項目。空文字へ戻していたため
    // 差分が出ず、いつまでも`spec.fields`へ現れなかった。
    const box = checkbox("");
    box.click();
    expect(box.saved()).toBe(true);
    box.click();
    expect(box.saved()).toBe(false);
  });

  it("既にある偽を入れて外しても、偽のまま残る", () => {
    const box = checkbox("false");
    box.click();
    expect(box.saved()).toBe(true);
    box.click();
    expect(box.saved()).toBe(false);
  });

  it("既にある真を外すと偽になる", () => {
    const box = checkbox("true");
    box.click();
    expect(box.saved()).toBe(false);
  });
});

/**
 * `reference`に`multiple: true`を付けた項目は、詳細の編集欄で`multiselect`と
 * 同じカンマ区切りの入力を扱い、保存すると配列になる。単一参照は今までどおり
 * 文字列で、編集欄の案内文も参照用のまま。
 */
describe("FieldInput の multiple: true の参照", () => {
  const multipleRef: PluginFieldDescriptor = {
    id: "dependsOn", label: "依存", type: "reference", path: ["fields", "dependsOn"], multiple: true
  };
  const singleRef: PluginFieldDescriptor = {
    id: "parent", label: "親", type: "reference", path: ["fields", "parent"]
  };

  it("カンマ区切りの入力を配列へ戻し、単一参照は文字列のまま", () => {
    expect(toSpecValue(multipleRef, "ticket-a, ticket-b,")).toEqual(["ticket-a", "ticket-b"]);
    expect(toSpecValue(multipleRef, "")).toBeNull();
    expect(toSpecValue(singleRef, "ticket-a")).toBe("ticket-a");
  });

  function render(field: PluginFieldDescriptor, value: string) {
    act(() => root.render(createElement(FieldInput, {
      field, id: "field-value", value, locale: "ja", onChange: () => {}
    })));
    return host.querySelector<HTMLInputElement>("input")!;
  }

  it("multiple参照はカンマ区切りの案内付きで描き、単一参照の案内は今までどおり", () => {
    // 2回目のrenderでReactが同じDOM節点を流用するため、属性は描き直前に読み取る。
    const multi = render(multipleRef, "ticket-a, ticket-b");
    expect(multi.value).toBe("ticket-a, ticket-b");
    const multiHint = multi.getAttribute("placeholder");
    expect(["カンマ区切り", "Comma separated", "plugin.multiselectHint"]).toContain(multiHint);
    const single = render(singleRef, "ticket-a");
    expect(single.getAttribute("placeholder")).not.toBe(multiHint);
  });
});
