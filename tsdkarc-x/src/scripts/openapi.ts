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
 * Compiled once at module load. Matches top-level TS object property shapes:
 *   id: string;
 *   role?: "admin";
 * Avoids recompiling the RegExp on every bestEffortTsToSchema call.
 */
const TS_PROPERTY_REGEX = /([a-zA-Z0-9_]+)\??\s*:\s*([^;}]+)/g;

/**
 * Best-effort converter from a raw TypeScript return type string
 * to a basic OpenAPI JSON Schema properties object.
 * Only handles top-level primitive shapes; nested objects produce `{ type: "object" }`.
 */
function bestEffortTsToSchema(tsType: string | undefined): object {
  if (!tsType || !tsType.includes("{")) return {};

  const properties: Record<string, any> = {};

  // Reset lastIndex before each use — required when reusing a global RegExp across calls.
  TS_PROPERTY_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TS_PROPERTY_REGEX.exec(tsType)) !== null) {
    const key = match[1];
    const val = match[2].trim();

    if (val === "string") properties[key] = { type: "string" };
    else if (val === "number") properties[key] = { type: "number" };
    else if (val === "boolean") properties[key] = { type: "boolean" };
    else if (val.includes("[]") || val.startsWith("Array"))
      properties[key] = { type: "array", items: {} };
    else if (val.startsWith("{")) properties[key] = { type: "object" };
    else if (val.includes('"') || val.includes("'"))
      properties[key] = { type: "string" }; // string literal / enum
    else properties[key] = {}; // fallback for complex types
  }

  return Object.keys(properties).length > 0 ? { properties } : {};
}

// ─── OpenAPI path item builder ────────────────────────────────────────────────

function buildPathItem(route: RouteInfo, meta?: Partial<SourceMeta>): object {
  const { segments, kind, method, inputSchema } = route;

  // Precomputed once — avoids split/join inside multiple expression sites.
  const dotPath = segments.join(".");
  const tag = segments[0];
  const operationId = segments.join("_");

  const hasInput = inputSchema !== null;
  const payloadArg = hasInput ? "data" : "";
  const clientCall = `api.${dotPath}.${kind}(${payloadArg})`;

  const inputBlock = !hasInput
    ? {}
    : method === "get"
    ? { parameters: buildQueryParams(inputSchema!) }
    : {
        requestBody: {
          required: true,
          content:
            kind === "upload"
              ? { "multipart/form-data": { schema: inputSchema! } }
              : { "application/json": { schema: inputSchema! } },
        },
      };

  const clientSnippet = `**Client Call:**\n\`\`\`typescript\n${clientCall}\n\`\`\``;
  const finalDescription = meta?.docs
    ? `${meta.docs}\n\n${clientSnippet}`
    : clientSnippet;

  const responseTsType =
    meta?.outputTs && meta.outputTs !== "unknown" ? meta.outputTs : "any";

  const trimmedType = responseTsType.trim();
  let rootType = "object";
  if (trimmedType === "string") rootType = "string";
  else if (trimmedType === "number") rootType = "number";
  else if (trimmedType === "boolean") rootType = "boolean";
  else if (trimmedType.endsWith("[]") || trimmedType.startsWith("Array"))
    rootType = "array";

  const responseSchema = {
    title: "Inferred Response",
    type: rootType,
    description: `### TypeScript Return Type\n\`\`\`typescript\ntype Response = ${responseTsType};\n\`\`\``,
    ...bestEffortTsToSchema(responseTsType),
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
