import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import type { PageView, RichTextBlock } from "./types.js";

// リッチエディタ（Milkdown commonmark + gfm）がデータを失わず往復できるノード種別。
// インライン／生HTML（例 `<br>`）とGFM表も含め、それらを入力してもブロック全体が
// 編集不可にならないようにする。
const SUPPORTED_NODE_TYPES = new Set<Nodes["type"]>([
  "root",
  "paragraph",
  "heading",
  "text",
  "emphasis",
  "strong",
  "link",
  "list",
  "listItem",
  "blockquote",
  "inlineCode",
  "code",
  "break",
  "html",
  "delete",
  "thematicBreak",
  "table",
  "tableRow",
  "tableCell"
]);

const NODE_NAMES: Partial<Record<Nodes["type"], string>> = {
  definition: "リンク定義",
  delete: "取り消し線",
  footnoteDefinition: "脚注",
  footnoteReference: "脚注",
  html: "HTML",
  image: "画像",
  imageReference: "参照形式の画像",
  linkReference: "参照形式のリンク",
  table: "表",
  tableCell: "表",
  tableRow: "表",
  thematicBreak: "区切り線",
  yaml: "YAML"
};

export interface EditAssessment {
  supported: boolean;
  reasons: string[];
}

export interface BlockEditAssessment {
  id: string;
  supported: boolean;
  reasons: string[];
}

export interface PageEditAssessment extends EditAssessment {
  /** 既知ブロックごとの編集可否。ここに無いエントリ（未知ブロック）は保存時に
   * 保持されるが、その場では編集できない。 */
  blocks: BlockEditAssessment[];
}

function childNodes(node: Nodes): Nodes[] {
  if (!("children" in node) || !Array.isArray(node.children)) return [];
  return node.children as Nodes[];
}

export function assessRichTextEditing(
  blocks: RichTextBlock[]
): EditAssessment {
  const unsupported = new Set<string>();

  for (const block of blocks) {
    const visit = (node: Nodes) => {
      if (!SUPPORTED_NODE_TYPES.has(node.type)) {
        unsupported.add(NODE_NAMES[node.type] ?? node.type);
      }
      childNodes(node).forEach(visit);
    };
    visit(fromMarkdown(block.content));
  }

  const reasons = [...unsupported].map(
    (name) => `${name}を含む本文はリッチ編集できません`
  );
  return { supported: reasons.length === 0, reasons };
}

export function assessPageEditing(view: PageView): PageEditAssessment {
  // ページ全体が読み取り専用のもの（安全に書き換えられないYAMLのalias/anchor等）は
  // 完全にロックしたままにする。
  if (view.readOnly) {
    const reasons = [...view.readOnlyReasons];
    if (reasons.length === 0) reasons.push("この文書は読み取り専用です");
    return { supported: false, reasons: [...new Set(reasons)], blocks: [] };
  }

  // 既知のrich-textブロックを個別に評価し、あるブロックの非対応ノード（や未知の
  // ブロック種別）がページ全体をロックしないようにする。未知ブロックはknownBlocksに
  // 含めず、保存時はそのまま保持して編集不可のままにする。
  const blocks: BlockEditAssessment[] = view.knownBlocks.map((block) => {
    const { supported, reasons } = assessRichTextEditing([block]);
    return { id: block.id, supported, reasons };
  });

  const editableCount = blocks.filter((block) => block.supported).length;
  if (editableCount === 0) {
    const reasons =
      view.knownBlocks.length === 0
        ? ["編集できる本文ブロックがありません"]
        : [...new Set(blocks.flatMap((block) => block.reasons))];
    return { supported: false, reasons, blocks };
  }

  return { supported: true, reasons: [], blocks };
}
