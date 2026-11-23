import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GitChanges } from "../packages/ui-react/src/shell/git-changes.js";
import { i18next } from "../packages/ui-react/src/shared/i18n.js";

it("renders default selection, change symbols, relative paths, unsaved warning and conditional push in both languages", async () => {
  const status = { available: true as const, branch: "main", upstream: "origin/main", ahead: 1, files: [
    { path: "folder/new.yaml", status: "A" }, { path: "changed.yaml", status: "M" }, { path: "gone.yaml", status: "D" }, { path: "moved.yaml", oldPath: "old.yaml", status: "R" }
  ] };
  const render = (current = status) => renderToStaticMarkup(React.createElement(GitChanges, { status: current, pages: [], unsaved: true, refresh: async () => {}, onHistory() {} }));
  await i18next.changeLanguage("en");
  const html = render();
  for (const label of ["＋ Added", "● Modified", "− Deleted", "→ Moved", "folder/new.yaml", "You have unsaved edits.", "Push", "Commit message", "Recent changes"]) expect(html).toContain(label);
  expect(html.match(/checked=""/g)).toHaveLength(4);
  expect(html).toContain('role="status"');
  expect(render({ ...status, ahead: 0 })).not.toContain(">Push</button>");
  expect(render({ ...status, upstream: "" })).toContain("This branch has no upstream.");
  await i18next.changeLanguage("ja");
  expect(render()).toContain("保存していない編集があります。");
});
