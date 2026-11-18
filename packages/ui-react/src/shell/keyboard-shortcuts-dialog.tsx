import { useTranslation } from "react-i18next";
import { Button } from "../shared/button.js";
import { Dialog } from "../shared/dialog.js";
import { DataTable } from "../shared/table.js";
import { SHORTCUTS, formatKeys, isMacPlatform, type ShortcutDefinition } from "./shortcuts.js";

/** The keyboard shortcut list, built from SHORTCUTS so it cannot drift from the handlers. */
export function KeyboardShortcutsDialog(props: { isOpen: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const isMac = isMacPlatform();
  return (
    <Dialog
      isOpen={props.isOpen}
      title={t("shortcuts.title")}
      onClose={props.onClose}
      actions={<Button onClick={props.onClose}>{t("shortcuts.close")}</Button>}
    >
      <DataTable<ShortcutDefinition>
        rows={SHORTCUTS}
        rowKey={(shortcut) => shortcut.id}
        caption={t("shortcuts.title")}
        columns={[
          { id: "action", label: t("shortcuts.action"), cell: (shortcut) => t(shortcut.label) },
          {
            id: "keys",
            label: t("shortcuts.keys"),
            cell: (shortcut) => formatKeys(shortcut.keys, isMac).map((key, index) => (
              <span key={key}>{index ? " / " : ""}<kbd>{key}</kbd></span>
            ))
          },
          { id: "where", label: t("shortcuts.where"), cell: (shortcut) => t(shortcut.scope) }
        ]}
      />
    </Dialog>
  );
}
