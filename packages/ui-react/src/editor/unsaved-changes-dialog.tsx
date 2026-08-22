import { useTranslation } from "react-i18next";

import { Button } from "../shared/button.js";
import { Dialog } from "../shared/dialog.js";
import styles from "./unsaved-changes-dialog.module.css";

export function UnsavedChangesDialog(props: {
  isOpen: boolean;
  destination?: string;
  busy?: boolean;
  onStay(): void;
  onSaveAndLeave?(): void;
  onDiscard(): void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      isOpen={props.isOpen}
      title={t("unsaved.title")}
      onClose={props.onStay}
      actions={
        <>
          <Button disabled={props.busy} onClick={props.onStay}>
            {t("unsaved.keepEditing")}
          </Button>
          {props.onSaveAndLeave && (
            <Button tone="primary" disabled={props.busy} onClick={props.onSaveAndLeave}>
              {props.busy ? t("unsaved.saving") : t("unsaved.saveAndLeave")}
            </Button>
          )}
          {/*
            書いたものを捨てる操作。**赤で塗らない。** 罫を太くして文言で示す。
            危険を色相だけに載せると、色を見分けられない利用者に伝わらない。
          */}
          <Button tone="danger" disabled={props.busy} onClick={props.onDiscard}>
            {t("unsaved.discard")}
          </Button>
        </>
      }
    >
      <p>
        {props.destination
          ? t("unsaved.destinationBody", { destination: props.destination })
          : t("unsaved.genericBody")}
      </p>
      <p className={styles.detail}>{t("unsaved.detail")}</p>
    </Dialog>
  );
}
