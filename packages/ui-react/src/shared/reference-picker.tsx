import { useMemo, useState } from "react";
import {
  Button as ComboBoxButton,
  ComboBox,
  Input,
  ListBox,
  ListBoxItem,
  Popover
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { Button } from "./button.js";
import styles from "./reference-picker.module.css";

export type ReferenceCandidate = { name: string; title: string };

function valuesOf(value: string | string[], multiple: boolean): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return multiple ? value.split(",").map((item) => item.trim()).filter(Boolean) : [value];
}

/**
 * A title-based picker for references. The stored value remains the resource name,
 * so changing the presentation does not change the YAML representation.
 */
export function ReferencePicker({
  id,
  candidates,
  value,
  multiple,
  exclude,
  disabled,
  autoFocus,
  onChange
}: {
  id: string;
  candidates: ReferenceCandidate[];
  value: string | string[];
  multiple?: boolean;
  exclude?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange(value: string | string[]): void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const selected = valuesOf(value, Boolean(multiple));
  const selectedSet = new Set(selected);
  const available = useMemo(
    () => candidates.filter((candidate) => candidate.name !== exclude),
    [candidates, exclude]
  );
  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    return available.filter((candidate) =>
      `${candidate.title} ${candidate.name}`.toLocaleLowerCase().includes(needle)
    );
  }, [available, query]);
  const byName = new Map(available.map((candidate) => [candidate.name, candidate]));

  function choose(name: string) {
    if (multiple) {
      if (!selectedSet.has(name)) onChange([...selected, name]);
    } else {
      onChange(name);
    }
    setQuery("");
  }

  function remove(name: string) {
    if (multiple) onChange(selected.filter((item) => item !== name));
    else onChange("");
  }

  return (
    <div className={styles.picker}>
      {multiple && selected.length ? (
        <ul className={styles.chips} aria-label={t("plugin.referenceSelected")}>
          {selected.map((name) => {
            const candidate = byName.get(name);
            return (
              <li key={name} className={styles.chip}>
                <span>{candidate ? candidate.title : `${name} ${t("plugin.referenceMissing")}`}</span>
                <Button
                  className={styles.remove}
                  disabled={disabled}
                  aria-label={t("plugin.referenceRemove", { title: candidate?.title ?? name })}
                  onClick={() => remove(name)}
                >
                  ×
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ComboBox
        aria-label={t("plugin.referenceSearch")}
        inputValue={query}
        isDisabled={disabled}
        allowsEmptyCollection
        onInputChange={setQuery}
        onSelectionChange={(key) => {
          if (key !== null) {
            choose(String(key));
          }
        }}
        selectedKey={multiple ? null : selected[0] ?? null}
      >
        <div className={styles.control}>
          <Input id={id} autoFocus={autoFocus} className={styles.input} placeholder={t("plugin.referenceSearch")} />
          <ComboBoxButton className={styles.toggle} aria-label={t("plugin.referenceShowCandidates")}>⌄</ComboBoxButton>
          {!multiple && selected.length ? (
            <Button
              className={styles.clear}
              disabled={disabled}
              aria-label={t("plugin.referenceClear")}
              onClick={() => remove(selected[0] ?? "")}
            >
              ×
            </Button>
          ) : null}
        </div>
        <Popover className={styles.popover}>
          {filtered.length ? (
            <ListBox className={styles.list}>
              {filtered.map((candidate) => (
              <ListBoxItem
                key={candidate.name}
                id={candidate.name}
                className={styles.option}
                textValue={`${candidate.title} ${candidate.name}`}
                onAction={() => choose(candidate.name)}
              >
                <span>{candidate.title}</span>
                <small>{candidate.name}</small>
              </ListBoxItem>
              ))}
            </ListBox>
          ) : (
            <div className={styles.empty} role="status">{t("plugin.referenceNoCandidates")}</div>
          )}
        </Popover>
      </ComboBox>
      {!multiple && selected.length ? (
        <span className={styles.selected}>
          {byName.has(selected[0] ?? "")
            ? byName.get(selected[0] ?? "")?.title
            : `${selected[0] ?? ""} ${t("plugin.referenceMissing")}`}
        </span>
      ) : null}
    </div>
  );
}
