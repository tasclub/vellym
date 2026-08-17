import { useTranslation } from "react-i18next";
import type { FolderSummary, PageSummary } from "@vellym-internal/core";
import type { PluginInputValue } from "@vellym/plugin-api";

import { PluginCommandDialog } from "../plugin/plugin-command-dialog.js";
import {
  StructureActionDialog,
  type StructureAction
} from "../editor/structure-dialog.js";
import { UnsavedChangesDialog } from "../editor/unsaved-changes-dialog.js";
import type {
  StructureApplyResult,
  StructurePlan
} from "../shared/api.js";

/**
 * 画面の上に重なるもの。ダイアログと、直後の取り消しの帯。
 *
 * どれも「いまの画面が何であっても出る」ものなので、本体の組み立てから
 * 切り離してある。表示の判断は持たせず、開くかどうかは呼ぶ側が決める。
 */
export function AppOverlays(props: {
  unsavedChanges: {
    isOpen: boolean;
    destination?: string;
    busy: boolean;
    onStay(): void;
    onSaveAndLeave(): void;
    onDiscard(): void;
  };
  pluginCommand: {
    command: Parameters<typeof PluginCommandDialog>[0]["command"];
    locale: string;
    onCancel(): void;
    onSubmit(input: Record<string, PluginInputValue>): void;
  };
  structureAction: {
    action: StructureAction | undefined;
    pages: PageSummary[];
    folders: FolderSummary[];
    onOpenChange(open: boolean): void;
    onApplied(plan: StructurePlan, result: StructureApplyResult): void;
  };
  /** 直前の構造変更を取り消せるときだけ渡す */
  undo?: { message: string; onUndo(): void };
}) {
  const { t } = useTranslation();
  return (
    <>
      <UnsavedChangesDialog
        isOpen={props.unsavedChanges.isOpen}
        destination={props.unsavedChanges.destination}
        busy={props.unsavedChanges.busy}
        onStay={props.unsavedChanges.onStay}
        onSaveAndLeave={props.unsavedChanges.onSaveAndLeave}
        onDiscard={props.unsavedChanges.onDiscard}
      />
      <PluginCommandDialog
        command={props.pluginCommand.command}
        locale={props.pluginCommand.locale}
        onCancel={props.pluginCommand.onCancel}
        onSubmit={props.pluginCommand.onSubmit}
      />
      <StructureActionDialog
        action={props.structureAction.action}
        pages={props.structureAction.pages}
        folders={props.structureAction.folders}
        onOpenChange={props.structureAction.onOpenChange}
        onApplied={props.structureAction.onApplied}
      />
      {props.undo && (
        <div className="structure-undo" role="status">
          <span>{props.undo.message}</span>
          <button type="button" onClick={props.undo.onUndo}>
            {t("app.undo")}
          </button>
        </div>
      )}
    </>
  );
}
