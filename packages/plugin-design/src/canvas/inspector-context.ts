import { indexBoard } from "../edit/selection.js";
import { updateNodes } from "../edit/transform.js";
import type { InspectorContext, PaintList } from "../panels/sections.js";
import { byBoard, type CanvasModel } from "./model.js";

const lengthLike = (value: unknown) => typeof value === "number" || /^-?\d*\.?\d+(?:px|rem|em)?$/.test(String(value));
const colorLike = (value: unknown) => typeof value === "string" && /^(?:#|rgba?\(|hsla?\(|color\(|oklch\(|oklab\(|lab\(|lch\()/i.test(value);

/** The right panel's context: the selection as nodes, tokens for its fields, and one-operation updates. */
export function inspectorContext(m: CanvasModel, extra: {
  tokens: Readonly<Record<string, string | number>>;
  editable: boolean;
  activeGradient?: { list: PaintList; paint: number };
  setActiveGradient: InspectorContext["setActiveGradient"];
  textRange?: InspectorContext["textRange"];
  clearTextRange(): void;
  arrange?: InspectorContext["arrange"];
  /** Called before a change so a text being edited is committed first. */
  beforeChange(): void;
}): InspectorContext {
  const { store, selected, geometry, context, t } = m;
  const pick = (test: (value: unknown) => boolean) => Object.entries(extra.tokens).filter(([, value]) => test(value))
    .map(([path, value]) => ({ path, value })).sort((a, b) => a.path.localeCompare(b.path));
  const inspector: InspectorContext = {
    targets: selected.flatMap(item => {
      const board = geometry.find(row => row.name === item.board), node = board?.index.get(item.id)?.node;
      return board && node ? [{ board: item.board, node, index: board.index }] : [];
    }),
    boards: m.boards.map(board => ({ name: board.name, title: board.title ?? board.name,
      width: board.spec.root.width, height: board.spec.root.height })),
    locale: m.locale, editable: extra.editable, lengthTokens: pick(lengthLike), colorTokens: pick(colorLike),
    resolveColor: value => {
      const token = /^\{(.+)\}$/.exec(value)?.[1];
      const resolved = token ? extra.tokens[token] : value;
      return typeof resolved === "string" ? resolved : undefined;
    },
    ...(context.uploadAsset && store.editable ? { uploadImage: async (file: File) => {
      const result = await context.uploadAsset!(file);
      if (!result.ok) { m.setStatus(`${t("uploadFailed")}: ${result.message}`); return undefined; }
      return result.path;
    } } : {}),
    activeGradient: extra.activeGradient, setActiveGradient: extra.setActiveGradient,
    textRange: extra.textRange, clearTextRange: extra.clearTextRange,
    ...(extra.arrange ? { arrange: extra.arrange } : {}),
    update(patch, mergeKey) {
      // A text being edited is finished first (its blur commits what was typed), so the change
      // below applies to the latest text and the editor cannot overwrite it later.
      extra.beforeChange();
      const changes = [...byBoard(selected)].flatMap(([name]) => {
        const before = m.currentRoot(name), board = geometry.find(row => row.name === name);
        if (!before || !board) return [];
        const fresh = indexBoard(before);
        const map = new Map(inspector.targets.filter(target => target.board === name).flatMap(target => {
          const node = fresh.get(target.node.id)?.node;
          const value = node && patch({ ...target, node, index: fresh });
          return value ? [[target.node.id, value] as const] : [];
        }));
        const after = map.size ? updateNodes(before, map) : before;
        return after !== before ? [{ targetName: name, before, after }] : [];
      });
      if (changes.length) store.apply({ changes, ...(mergeKey ? { mergeKey } : {}) });
    },
    selectBoard(name) {
      const board = geometry.find(row => row.name === name);
      const root = board && [...board.index.values()].find(item => item.depth === 0)?.node.id;
      if (root !== undefined) m.setSelected([{ board: name, id: root }]);
    }
  };
  return inspector;
}
