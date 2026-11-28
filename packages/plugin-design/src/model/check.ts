/**
 * A small JSON Schema check for the keywords the design schema uses (type, properties, required,
 * additionalProperties, enum, const, items, minItems, maxItems, minimum, maximum, pattern, anyOf,
 * oneOf, not, $ref into the same document's $defs). The browser cannot use the host's validator;
 * tests compare this with it.
 */
type Schema = Record<string, unknown>;

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}

export function matchesSchema(value: unknown, schema: Schema | boolean, root: Schema): boolean {
  if (schema === true) return true;
  if (schema === false) return false;
  if (typeof schema.$ref === "string") {
    const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1];
    const target = name ? (root.$defs as Record<string, Schema> | undefined)?.[name] : undefined;
    if (!target || !matchesSchema(value, target, root)) return false;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string];
    if (!types.some(type => typeMatches(value, type))) return false;
  }
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }
  if (typeof value === "string" && typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return false;
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.items !== undefined && !value.every(item => matchesSchema(item, schema.items as Schema, root))) return false;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(schema.required) && !schema.required.every(key => key in record)) return false;
    const properties = (schema.properties ?? {}) as Record<string, Schema | boolean>;
    for (const [key, item] of Object.entries(record)) {
      if (key in properties) { if (!matchesSchema(item, properties[key]!, root)) return false; }
      else if (schema.additionalProperties !== undefined && !matchesSchema(item, schema.additionalProperties as Schema | boolean, root)) return false;
    }
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(item => matchesSchema(value, item as Schema, root))) return false;
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter(item => matchesSchema(value, item as Schema, root)).length !== 1) return false;
  if (schema.not !== undefined && matchesSchema(value, schema.not as Schema | boolean, root)) return false;
  return true;
}
