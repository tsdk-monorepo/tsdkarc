// codegen/schema-to-zod.ts

/**
 * Convert a JSON Schema object to a Zod schema string for codegen.
 * Output is a TypeScript expression string, not a runtime value.
 * No runtime dependencies — pure string generation.
 */

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  /**
   * OpenAPI 3.0 nullable flag.
   * In OpenAPI 3.1 this is expressed as type: ["string", "null"] instead.
   */
  nullable?: boolean;
  description?: string;
  /**
   * Additional properties schema for open-ended objects.
   * true  → z.record(z.unknown())
   * false → strict object, no extra keys (not expressible in Zod directly, ignored)
   * JsonSchema → z.record(<schema>)
   */
  additionalProperties?: JsonSchema | boolean;
};

/**
 * Determine if a schema is nullable.
 * Handles both OpenAPI 3.0 `nullable: true` and
 * OpenAPI 3.1 `type: ["string", "null"]` array syntax.
 */
function isNullable(schema: JsonSchema): boolean {
  if (schema.nullable) return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  return false;
}

/**
 * Extract the primary (non-null) type from a schema.
 * Handles OpenAPI 3.1 array types: ["string", "null"] → "string".
 */
function primaryType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== "null") ?? schema.type[0];
  }
  return schema.type;
}

/**
 * Convert a JSON Schema to a Zod schema string.
 * @param schema    JSON Schema object
 * @param required  Whether this field is required in its parent object
 */
export function schemaToZodString(schema: JsonSchema, required = true): string {
  const base = baseZodString(schema);
  const nullable = isNullable(schema);

  if (nullable && !required) return `${base}.nullable().optional()`;
  if (nullable) return `${base}.nullable()`;
  if (!required) return `${base}.optional()`;
  return base;
}

function baseZodString(schema: JsonSchema): string {
  if (!schema) return "z.unknown()";

  // enum — z.enum or z.literal
  if (schema.enum?.length) {
    if (schema.enum.length === 1) {
      return `z.literal(${JSON.stringify(schema.enum[0])})`;
    }
    const allStrings = schema.enum.every((v) => typeof v === "string");
    if (allStrings) {
      return `z.enum([${schema.enum
        .map((v) => JSON.stringify(v))
        .join(", ")}])`;
    }
    return `z.union([${schema.enum
      .map((v) => `z.literal(${JSON.stringify(v)})`)
      .join(", ")}])`;
  }

  // oneOf / anyOf → z.union
  if (schema.oneOf?.length) {
    if (schema.oneOf.length === 1) return schemaToZodString(schema.oneOf[0]);
    return `z.union([${schema.oneOf
      .map((s) => schemaToZodString(s))
      .join(", ")}])`;
  }
  if (schema.anyOf?.length) {
    if (schema.anyOf.length === 1) return schemaToZodString(schema.anyOf[0]);
    return `z.union([${schema.anyOf
      .map((s) => schemaToZodString(s))
      .join(", ")}])`;
  }

  // allOf → z.intersection chain
  if (schema.allOf?.length) {
    if (schema.allOf.length === 1) return schemaToZodString(schema.allOf[0]);
    return schema.allOf
      .map((s) => schemaToZodString(s))
      .reduce((a, b) => `z.intersection(${a}, ${b})`);
  }

  const type = primaryType(schema);

  switch (type) {
    case "string":
      return stringZod(schema);
    case "number":
      return numberZod(schema);
    case "integer":
      return integerZod(schema);
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array":
      return arrayZod(schema);
    case "object":
      return objectZod(schema);
    default:
      if (schema.properties || schema.additionalProperties)
        return objectZod(schema);
      return "z.unknown()";
  }
}

function stringZod(schema: JsonSchema): string {
  let chain = "z.string()";
  if (schema.format === "email") chain += ".email()";
  if (schema.format === "uuid") chain += ".uuid()";
  if (schema.format === "uri") chain += ".url()";
  if (schema.format === "date-time") chain += ".datetime()";
  if (schema.minLength !== undefined) chain += `.min(${schema.minLength})`;
  if (schema.maxLength !== undefined) chain += `.max(${schema.maxLength})`;
  if (schema.pattern) chain += `.regex(/${schema.pattern}/)`;
  return chain;
}

function numberZod(schema: JsonSchema): string {
  let chain = "z.number()";
  if (schema.minimum !== undefined) chain += `.min(${schema.minimum})`;
  if (schema.maximum !== undefined) chain += `.max(${schema.maximum})`;
  return chain;
}

function integerZod(schema: JsonSchema): string {
  let chain = "z.number().int()";
  if (schema.minimum !== undefined) chain += `.min(${schema.minimum})`;
  if (schema.maximum !== undefined) chain += `.max(${schema.maximum})`;
  return chain;
}

function arrayZod(schema: JsonSchema): string {
  const items = schema.items ? schemaToZodString(schema.items) : "z.unknown()";
  return `z.array(${items})`;
}

function objectZod(schema: JsonSchema): string {
  // additionalProperties only — open record type
  if (!schema.properties && schema.additionalProperties) {
    const valSchema =
      typeof schema.additionalProperties === "object"
        ? schemaToZodString(schema.additionalProperties)
        : "z.unknown()";
    return `z.record(${valSchema})`;
  }

  // No properties and no additionalProperties — unknown record
  if (!schema.properties) return "z.record(z.unknown())";

  const fields = Object.entries(schema.properties)
    .map(([k, v]) => {
      const isRequired = schema.required?.includes(k) ?? false;
      return `  ${k}: ${schemaToZodString(v, isRequired)}`;
    })
    .join(",\n");

  // Has both properties and additionalProperties — extend with catchall
  const catchall =
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
      ? `.catchall(${schemaToZodString(schema.additionalProperties)})`
      : schema.additionalProperties === true
      ? ".catchall(z.unknown())"
      : "";

  return `z.object({\n${fields}\n})${catchall}`;
}
