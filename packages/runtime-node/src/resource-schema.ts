export type JsonSchema = Record<string, unknown>;

export interface ResourceSchemaOptions {
  /** A Core resource schema whose metadata and other top-level rules are reused. */
  pageSchema: JsonSchema;
  kind: string;
  specSchema: JsonSchema;
  /** API version segment, such as `v1` or `v1alpha1`. */
  version: string;
}

function schemaFileName(kind: string): string {
  const kebabCase = kind
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return `${encodeURIComponent(kebabCase)}.schema.json`;
}

/**
 * Builds a complete resource schema from a Core resource schema and a kind's
 * `spec` schema. The inputs are not mutated.
 */
export function resourceSchema({
  pageSchema,
  kind,
  specSchema,
  version
}: ResourceSchemaOptions): JsonSchema {
  const properties = pageSchema.properties;
  const resourceProperties =
    typeof properties === "object" && properties !== null && !Array.isArray(properties)
      ? (properties as JsonSchema)
      : {};

  return {
    ...pageSchema,
    $id: `https://vellym.tasclub.com/schemas/${version}/${schemaFileName(kind)}`,
    title: `Vellym ${kind}`,
    properties: {
      ...resourceProperties,
      apiVersion: { const: `vellym.tasclub.com/${version}` },
      kind: { const: kind },
      spec: specSchema
    }
  };
}
