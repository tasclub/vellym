import { useRef } from "react";
import { designText } from "../i18n.js";
import type { Tool } from "./shape-tools.js";

type Text = keyof typeof designText;
const MAIN: readonly [Tool, Text, string][] = [
  ["select", "toolSelect", "V"], ["hand", "hand", "H"], ["frame", "toolFrame", "F"],
  ["rectangle", "toolRectangle", "R"], ["ellipse", "toolEllipse", "O"], ["line", "toolLine", "L"]
];

/** Drawing tools. The host's own buttons are not used (plugins do not import ui-react). */
export function Toolbar({ tool, onTool, onImage, locale, editable }: {
  tool: Tool; onTool: (tool: Tool) => void; onImage?: (files: FileList) => void;
  locale: "ja" | "en"; editable: boolean;
}) {
  const t = (key: Text) => designText[key][locale];
  const file = useRef<HTMLInputElement>(null);
  const tools = editable ? MAIN : MAIN.slice(0, 2);
  return <div className="design-toolbar" role="toolbar" aria-label={t("tools")} data-testid="design-toolbar">
    {tools.map(([id, label, key]) => <button key={id} type="button" aria-pressed={tool === id}
      data-testid={id === "hand" ? "design-hand" : `design-tool-${id}`} aria-keyshortcuts={key}
      onClick={() => onTool(tool === id && id === "hand" ? "select" : id)}>{t(label)}</button>)}
    {editable && <label className="design-more-shapes">
      <span className="design-visually-hidden">{t("moreShapes")}</span>
      <select data-testid="design-tool-more" value={tool === "polygon" || tool === "star" ? tool : ""}
        onChange={event => { if (event.target.value) onTool(event.target.value as Tool); }}>
        <option value="">{t("moreShapes")}</option>
        <option value="polygon">{t("toolPolygon")}</option>
        <option value="star">{t("toolStar")}</option>
      </select>
    </label>}
    {editable && onImage && <>
      <button type="button" data-testid="design-tool-image" onClick={() => file.current?.click()}>{t("toolImage")}</button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden
        data-testid="design-image-input" onChange={event => {
          if (event.target.files?.length) onImage(event.target.files);
          event.target.value = "";
        }} />
    </>}
  </div>;
}
