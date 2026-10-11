import type { PluginIndexValue } from "@vellym/plugin-api";
import type { FieldDefinition } from "@vellym-internal/ticket-engine";

/** Interpret the projected field value, never the source Ticket spec. */
export function cardFieldValue(
  field: FieldDefinition,
  value: PluginIndexValue | undefined,
  locale: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (field.type === "boolean") {
    if (typeof value !== "boolean") return String(value);
    return value ? (locale.startsWith("ja") ? "✓ はい" : "✓ Yes")
      : (locale.startsWith("ja") ? "□ いいえ" : "□ No");
  }
  if (field.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const label = (entry: string) => field.options?.find((option) => option.value === entry)?.label ?? entry;
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (field.type === "select" && typeof value === "string") return label(value);
  return String(value);
}
