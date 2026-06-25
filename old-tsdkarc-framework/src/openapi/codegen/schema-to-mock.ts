// codegen/schema-to-mock.ts

/**
 * Generate a realistic mock value from a JSON Schema object.
 * Used to produce mock responses from OpenAPI response schemas.
 * No runtime dependencies — pure value generation.
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
  default?: unknown;
  example?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  nullable?: boolean;
};

/**
 * Generate a mock value from a JSON Schema.
 * Priority: example > default > enum[0] > generated value.
 * @param schema  JSON Schema object
 * @param key     Optional field name — used to generate realistic string values
 */
export function schemaToMock(schema: JsonSchema, key = ""): unknown {
  if (!schema) return null;

  // Use example or default if provided
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];

  // Handle oneOf / anyOf — use first variant
  if (schema.oneOf?.length) return schemaToMock(schema.oneOf[0], key);
  if (schema.anyOf?.length) return schemaToMock(schema.anyOf[0], key);

  // Handle allOf — merge all variants
  // if (schema.allOf?.length) {
  //   return schema.allOf.reduce(
  //     (acc, s) => ({ ...(acc as object), ...(schemaToMock(s, key) as object) }),
  //     {}
  //   );
  // }
  if (schema.allOf?.length) {
    return schema.allOf.reduce<object>((acc, s) => {
      const v = schemaToMock(s, key);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return { ...acc, ...(v as object) };
      }
      return acc;
    }, {});
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case "string":
      return mockString(key, schema.format);
    case "number":
    case "integer":
      return schema.minimum ?? 0;
    case "boolean":
      return true;
    case "null":
      return null;
    case "array":
      return schema.items ? [schemaToMock(schema.items, key)] : [];
    case "object":
      return mockObject(schema);
    default:
      // No type — try object if has properties, else null
      if (schema.properties) return mockObject(schema);
      return null;
  }
}

/**
 * Generate a realistic string mock based on field name and format.
 * @param key     Field name hint
 * @param format  JSON Schema format (e.g. "date-time", "email", "uuid")
 */
function mockString(key: string, format?: string): string {
  if (format) {
    switch (format) {
      case "date-time":
        return "2024-01-01T00:00:00Z";
      case "date":
        return "2024-01-01";
      case "time":
        return "00:00:00";
      case "email":
        return "user@example.com";
      case "uuid":
        return "00000000-0000-0000-0000-000000000000";
      case "uri":
        return "https://example.com";
      case "hostname":
        return "example.com";
      case "ipv4":
        return "127.0.0.1";
      case "ipv6":
        return "::1";
      case "password":
        return "password";
      default:
        return format;
    }
  }

  // Use field name to generate realistic values
  const k = key.toLowerCase();
  if (k.includes("id")) return `${key}_value`;
  if (k.includes("name")) return "John Doe";
  if (k.includes("email")) return "user@example.com";
  if (k.includes("url") || k.includes("uri")) return "https://example.com";
  if (k.includes("phone")) return "+1234567890";
  if (k.includes("date")) return "2024-01-01";
  if (k.includes("time")) return "2024-01-01T00:00:00Z";
  if (k.includes("token")) return "token_value";
  if (k.includes("password")) return "password";
  if (k.includes("description")) return "A description.";
  if (k.includes("title")) return "A title";
  if (k.includes("status")) return "active";
  if (k.includes("type")) return "default";
  if (k.includes("color")) return "#000000";
  if (k.includes("avatar") || k.includes("image") || k.includes("photo"))
    return "https://example.com/image.png";

  return key || "string";
}

/**
 * Generate a mock object from a JSON Schema object type.
 */
function mockObject(schema: JsonSchema): Record<string, unknown> {
  if (!schema.properties) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema.properties)) {
    result[k] = schemaToMock(v, k);
  }
  return result;
}
