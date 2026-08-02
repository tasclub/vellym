import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay
} from "react-aria-components";
import { useTranslation } from "react-i18next";
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
    <ModalOverlay
      className={styles.overlay}
      isOpen={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onStay();
      }}
      isDismissable
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <Heading slot="title">{t("unsaved.title")}</Heading>
          <p>
            {props.destination
              ? t("unsaved.destinationBody", { destination: props.destination })
              : t("unsaved.genericBody")}
          </p>
          <p className={styles.detail}>{t("unsaved.detail")}</p>
          <div className={styles.actions}>
            <Button
              className={styles.secondary}
              isDisabled={props.busy}
              onPress={props.onStay}
            >
              {t("unsaved.keepEditing")}
            </Button>
            {props.onSaveAndLeave && (
              <Button
                className={styles.primary}
                isDisabled={props.busy}
                onPress={props.onSaveAndLeave}
              >
                {props.busy ? t("unsaved.saving") : t("unsaved.saveAndLeave")}
              </Button>
            )}
            <Button
              className={styles.danger}
              isDisabled={props.busy}
              onPress={props.onDiscard}
            >
              {t("unsaved.discard")}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
