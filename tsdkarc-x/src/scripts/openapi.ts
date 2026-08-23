// openapi.ts
//
// Runtime OpenAPI 3.1.0 spec generator with Hybrid AST Comment & TypeScript Extraction.
//
// Performance optimizations over v1:
//   1. WeakMap cache for zodSchemaToJson — avoids re-running z.toJSONSchema for shared schemas
//   2. Hoisted TS_PROPERTY_REGEX — compiled once at module load, not per bestEffortTsToSchema call
//   3. Precomputed path segments in buildPathItem — path.split("/") called once per route
//   4. Corrected z.toJSONSchema target from "openapi-3.0" to "openapi-3.1" to match spec version

import { z } from "zod";
import type { ZodType } from "zod";
import type { RuntimeRouteTree } from "../types";
import { extractReturnTypesFromSource } from "./extract-types";
import type { SourceEnrichOptions, SourceMeta } from "./extract-types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenApiOptions {
  info: OpenApiInfo;
  servers?: { url: string }[];
  excludePaths?: string[];
  tags?: { name: string; description: string }[];
}

export interface OpenApiSpec {
  openapi: "3.1.0";
  info: OpenApiInfo;
  servers: { url: string }[];
  tags?: { name: string; description: string }[];
  paths: Record<string, object>;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

const ROUTE_KINDS = new Set([
  "query",
  "mutate",
  "stream",
  "upload",
  "plain",
] as const);
type RouteKind = "query" | "mutate" | "stream" | "upload" | "plain";

interface NormalisedRoute {
  _kind: RouteKind;
  schema?: ZodType;
}

interface RouteInfo {
  path: string;
  /** Path split on "/" — precomputed once to avoid repeated splits in buildPathItem. */
  segments: string[];
  kind: RouteKind;
  method: "get" | "post";
  inputSchema: object | null;
}

function isRouteLeaf(node: unknown): node is NormalisedRoute {
  return (
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    "_kind" in node &&
    ROUTE_KINDS.has((node as any)._kind)
  );
}

/**
 * WeakMap cache for Zod schema → JSON Schema conversion.
 * Same schema object identity = same result; no need to re-run z.toJSONSchema.
 * WeakMap ensures no memory leak when schema objects are GC'd.
 *
 * Target is "openapi-3.1" to match the spec version declared in OpenApiSpec.
 * Using "openapi-3.0" would emit `nullable: true` instead of `type: ["T", "null"]`,
 * which is invalid in OpenAPI 3.1 / JSON Schema 2020-12.
 */
const zodJsonCache = new WeakMap<ZodType, object>();

function zodSchemaToJson(schema: ZodType | undefined): object | null {
  if (!schema) return null;

  const cached = zodJsonCache.get(schema);
  if (cached !== undefined) return cached;

  const { $schema, ...rest } = z.toJSONSchema(schema, {
    target: "openapi-3.1",
    unrepresentable: "any",
  }) as any;

  // NEW: Intercept Zod object shapes to fix File/Blob definitions
  if (rest.type === "object" && rest.properties && (schema as any).shape) {
    patchZodOpenApiBinary((schema as any).shape, rest.properties);
  }

  zodJsonCache.set(schema, rest);
  return rest;
}

function collectRoutes(tree: RuntimeRouteTree, prefix = ""): RouteInfo[] {
  const result: RouteInfo[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${key}` : key;
    if (isRouteLeaf(value)) {
      const kind = value._kind;
      result.push({
        path,
        segments: path.split("/"),
        kind: kind === "plain" ? "query" : kind,
        method:
          kind === "mutate" || kind === "stream" || kind === "upload"
            ? "post"
            : "get",
        inputSchema: zodSchemaToJson(value.schema),
      });
    } else if (typeof value === "object" && value !== null) {
      result.push(...collectRoutes(value as RuntimeRouteTree, path));
    }
  }
  return result;
}

function buildQueryParams(
  schema: object
): Array<{ name: string; in: string; schema: object; required: boolean }> {
  const s = schema as {
    properties?: Record<string, object>;
    required?: string[];
  };
  if (!s.properties) return [];
  return Object.entries(s.properties).map(([name, propSchema]) => ({
    name,
    in: "query",
    schema: propSchema,
    required: (s.required ?? []).includes(name),
  }));
}

// ─── TypeScript Heuristic Parser ──────────────────────────────────────────────

/**
 * Matches a single `key: value` chunk once brace-depth splitting has already
 * isolated it. No global/lastIndex state, so it's safe to reuse across calls.
 */
const TS_PROPERTY_LINE_REGEX = /^([a-zA-Z0-9_]+)\??\s*:\s*([\s\S]+)$/;

/**
 * Splits the top-level `;`-separated members of a TS object-type body,
 * tracking brace depth so a `;` inside a nested `{ ... }` is never mistaken
 * for a separator between top-level properties.
 * @param body string — content strictly between the outermost `{` and `}`
 * @returns string[] raw `key: value` chunks, one per top-level property
 */
function splitTopLevelProperties(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "{") depth++;
    else if (char === "}") depth--;

    if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Finds the first top-level `{ ... }` object-literal span in `tsType` and
 * returns its inner content, tracking brace depth so a nested object's
 * closing brace doesn't end the scan early.
 * @param tsType string
 * @returns string | null — inner content, or null if no balanced `{...}` exists
 */
function extractOuterObjectBody(tsType: string): string | null {
  const start = tsType.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < tsType.length; i++) {
    if (tsType[i] === "{") depth++;
    else if (tsType[i] === "}") {
      depth--;
      if (depth === 0) return tsType.slice(start + 1, i);
    }
  }
  return null; // unbalanced braces — best effort gives up
}

/**
 * Recursively parses an object type string `{ key: type; ... }` into a JSON Schema object.
 */
function parseTsObjectType(tsTypeStr: string): Record<string, any> {
  const body = extractOuterObjectBody(tsTypeStr);
  if (!body) return { type: "object" };

  const properties: Record<string, any> = {};

  for (const rawChunk of splitTopLevelProperties(body)) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;

    const propMatch = TS_PROPERTY_LINE_REGEX.exec(chunk);
    if (!propMatch) continue;

    const key = propMatch[1];
    const val = propMatch[2].trim();

    properties[key] = resolveTsTypeStr(val);
  }

  return Object.keys(properties).length > 0
    ? { type: "object", properties }
    : { type: "object" };
}

/**
 * Resolves any TS type string into an OpenAPI schema field (supports primitives, unions, arrays, and nested objects).
 */
function resolveTsTypeStr(rawVal: string): any {
  // 1. Strip optional / null unions
  const types = rawVal.split("|").map((s) => s.trim());
  const cleanVal =
    types.find((t) => t !== "undefined" && t !== "null") || types[0];

  // 2. Primitives
  if (cleanVal === "string") return { type: "string" };
  if (cleanVal === "number") return { type: "number" };
  if (cleanVal === "boolean") return { type: "boolean" };

  // 3. Array shorthand (e.g., "{ id: string }[]" or "number[]")
  if (cleanVal.endsWith("[]")) {
    const itemType = cleanVal.slice(0, -2).trim();
    if (itemType === "never") return { type: "array", items: {} };
    return { type: "array", items: resolveTsTypeStr(itemType) };
  }

  // 4. Generic Array (e.g., "Array<{ id: string }>")
  if (cleanVal.startsWith("Array<") && cleanVal.endsWith(">")) {
    const itemType = cleanVal.slice(6, -1).trim();
    return { type: "array", items: resolveTsTypeStr(itemType) };
  }

  // 5. Nested Objects: Recurse if value starts with `{`
  if (cleanVal.startsWith("{")) {
    return parseTsObjectType(cleanVal);
  }

  // 6. String Literals / Enums
  if (cleanVal.includes('"') || cleanVal.includes("'")) {
    return { type: "string" };
  }

  return {};
}

/**
 * Entry point: Best-effort converter from TS return/input type string to OpenAPI properties.
 */
function bestEffortTsToSchema(tsType: string | undefined): object {
  if (!tsType) return {};
  const body = extractOuterObjectBody(tsType);
  if (body === null) return {};

  const schema = parseTsObjectType(tsType);
  // Return just the { properties: { ... } } block for top-level spreading
  return schema.properties ? { properties: schema.properties } : {};
}

// ─── OpenAPI path item builder ────────────────────────────────────────────────
function buildPathItem(route: RouteInfo, meta?: Partial<SourceMeta>): object {
  const { segments, kind, method, inputSchema } = route;

  // Precomputed once
  const dotPath = segments.join(".");
  const tag = segments[0];
  const operationId = segments.join("_");

  // NEW: Try Zod first, fallback to TS AST extraction
  let finalInputSchema = inputSchema;
  if (
    !finalInputSchema &&
    meta?.inputTsExpanded &&
    meta.inputTsExpanded !== "unknown"
  ) {
    finalInputSchema = {
      title: "Inferred Request",
      type: "object",
      ...bestEffortTsToSchema(meta.inputTsExpanded),
    };
  }

  const hasInput = finalInputSchema !== null && finalInputSchema !== undefined;
  const payloadArg = hasInput ? "data" : "";
  const clientCall = `api.${dotPath}.${kind}(${payloadArg})`;

  const inputBlock = !hasInput
    ? {}
    : method === "get"
    ? { parameters: buildQueryParams(finalInputSchema!) }
    : {
        requestBody: {
          required: true,
          content:
            kind === "upload"
              ? { "multipart/form-data": { schema: finalInputSchema! } }
              : { "application/json": { schema: finalInputSchema! } },
        },
      };

  const clientSnippet = `**Client Call:**\n\`\`\`typescript\n${clientCall}\n\`\`\``;
  const finalDescription = meta?.docs
    ? `${meta.docs}\n\n${clientSnippet}`
    : clientSnippet;
  const responseTsType =
    meta?.outputTsExpanded && meta.outputTsExpanded !== "unknown"
      ? meta.outputTsExpanded
      : "any";

  const responseSchema = {
    title: "Inferred Response",
    type: "object", // Root type fallback
    ...bestEffortTsToSchema(responseTsType),
    description: `### TypeScript Return Type\n\`\`\`typescript\ntype Response = ${
      meta?.outputTs || "any"
    };\n\`\`\``,
  };

  return {
    [method]: {
      operationId,
      tags: [tag],
      "x-kind": kind,
      summary: clientCall,
      description: finalDescription,
      ...inputBlock,
      responses: {
        "200": {
          description: "Success",
          content: { "application/json": { schema: responseSchema } },
        },
        "400": { description: "Validation error" },
        "500": { description: "Internal server error" },
      },
    },
  };
}

export function extractOpenApi(
  routes: RuntimeRouteTree,
  options: OpenApiOptions,
  sourceOptions: SourceEnrichOptions
): OpenApiSpec {
  const routesExportName = sourceOptions.routesExportName ?? "routes";

  // extractReturnTypesFromSource internally uses the cached ts.Program from extract-types.ts,
  // so repeated calls here (e.g. during dev hot-reload) do not re-parse the whole project.
  const { leaves } = extractReturnTypesFromSource(
    sourceOptions.entryFile,
    routesExportName,
    sourceOptions,
    sourceOptions.tsConfigFilePath
  );

  const excluded = new Set(options.excludePaths ?? []);
  const allRoutes = collectRoutes(routes).filter((r) => !excluded.has(r.path));

  const paths: Record<string, object> = {};
  for (const route of allRoutes) {
    paths[`/${route.path}`] = buildPathItem(route, leaves.get(route.path));
  }

  return {
    openapi: "3.1.0",
    info: options.info,
    servers: options.servers ?? [],
    ...(options.tags?.length ? { tags: options.tags } : {}),
    paths,
  };
}

/** Unwraps ZodOption, ZodDefault, etc., to get the core type */
function unwrapZodType(schema: any): any {
  if (typeof schema.unwrap === "function")
    return unwrapZodType(schema.unwrap());
  if (typeof schema.removeDefault === "function")
    return unwrapZodType(schema.removeDefault());
  if (schema._def?.innerType) return unwrapZodType(schema._def.innerType);
  return schema;
}

/** Patches empty objects into OpenAPI binary formats if they are Files/Blobs */
function patchZodOpenApiBinary(
  zodShape: Record<string, any>,
  openApiProperties: Record<string, any>
) {
  for (const [key, propSchema] of Object.entries(zodShape)) {
    const inner = unwrapZodType(propSchema);
    // Support standard Zod `.class` and your custom `_zod.bag.Class`
    const cls = inner._def?.class || inner._zod?.bag?.Class;

    if (
      typeof cls === "function" &&
      (cls.name === "File" || cls.name === "Blob")
    ) {
      openApiProperties[key] = { type: "string", format: "binary" };
    }
  }
}
