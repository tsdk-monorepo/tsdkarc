// openapi.module.ts

import ts from "typescript";
import { defineUnit } from "tsdkarc";
import { DefineRoutesFn } from "../server/create-server";

// ─── Module ───────────────────────────────────────────────────────────────────

export interface OpenApiOptions {
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  /** Absolute path to the file that exports `type App`. */
  appFile: string;
  /** Route paths to exclude from the spec. Default: ["openapi"] */
  excludePaths?: string[];
  /**
   * Manual tag descriptions for namespaces.
   * JSDoc on namespace objects cannot survive TypeScript type projection,
   * so descriptions must be provided explicitly here.
   * @example [{ name: "user", description: "User management routes." }]
   */
  tags?: { name: string; description: string }[];
}

export function openApiModule(opts: OpenApiOptions) {
  return defineUnit()({
    name: "openapi",
    boot() {
      const result = extractOpenApi(opts.appFile, opts);
      console.log(`[openapi] ${result.routes.length} routes extracted`);
      return { openapi: result };
    },
  });
}

/**
 * Convenience route that serves the OpenAPI spec as a GET endpoint.
 * Registers a /openapi route that returns the generated spec JSON.
 *
 * @example
 * const app = createApp([userModule, openApiRoute({ appFile: "./src/routes.ts", info: { title: "My API", version: "1.0.0" } })]);
 */
export const openApiRoute = (
  options: OpenApiOptions,
  defineRoutes: DefineRoutesFn
) =>
  defineRoutes({
    modules: [openApiModule(options)],
  })({
    openapi(ctx) {
      return ctx.openapi.spec;
    },
  });

// ─── Type → JsonSchema ────────────────────────────────────────────────────────

/**
 * Symbol names used by TypeScript's lib for async iterator shapes.
 * Covers: AsyncGenerator<T>, AsyncIterator<T>, AsyncIterable<T>,
 *         AsyncIterableIterator<T>.
 */
const ASYNC_ITERATOR_SYMBOLS = new Set([
  "AsyncGenerator",
  "AsyncIterator",
  "AsyncIterable",
  "AsyncIterableIterator",
]);

/**
 * Returns true if `type` is an async iterator / generator shape.
 * Detected by symbol name — avoids walking the full prototype chain.
 *
 * @param type  ts.Type
 * @returns     boolean
 */
function isAsyncIteratorType(type: ts.Type): boolean {
  return ASYNC_ITERATOR_SYMBOLS.has(type.symbol?.name ?? "");
}

function typeToSchema(checker: ts.TypeChecker, type: ts.Type): object {
  // ─── Primitives ───────────────────────────────────────────────────────────
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };

  // Explicitly return the "null" type (OpenAPI 3.1.0 standard)
  if (type.flags & ts.TypeFlags.Null) return { type: "null" };
  if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return {};

  // ─── Literals ─────────────────────────────────────────────────────────────
  if (type.flags & ts.TypeFlags.StringLiteral)
    return { type: "string", enum: [(type as ts.StringLiteralType).value] };
  if (type.flags & ts.TypeFlags.NumberLiteral)
    return { type: "number", enum: [(type as ts.NumberLiteralType).value] };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: "boolean" };

  // ─── Unions & Nullables ───────────────────────────────────────────────────
  if (type.isUnion()) {
    // 1. Separate undefined and null from the core types
    const nonUndefined = type.types.filter(
      (t) => !(t.flags & ts.TypeFlags.Undefined)
    );
    const nonNullish = nonUndefined.filter(
      (t) => !(t.flags & ts.TypeFlags.Null)
    );
    const hasNull = nonUndefined.length > nonNullish.length;

    // 2. Single core type (e.g., z.string().nullable() -> string | null)
    if (nonNullish.length === 1) {
      const baseSchema: any = typeToSchema(checker, nonNullish[0]);
      if (hasNull) {
        // Upgrade string/number/object to an array type: ["string", "null"]
        if (typeof baseSchema.type === "string") {
          baseSchema.type = [baseSchema.type, "null"];
        } else {
          // Fallback for complex base schemas without a simple string type
          return { anyOf: [baseSchema, { type: "null" }] };
        }
      }
      return baseSchema;
    }

    // 3. Literals / Enums (e.g., z.enum(["A", "B"]).nullable())
    const allStringLiterals = nonNullish.every(
      (t) => t.flags & ts.TypeFlags.StringLiteral
    );
    if (allStringLiterals) {
      const enumValues = nonNullish.map(
        (t) => (t as ts.StringLiteralType).value
      );
      if (hasNull) enumValues.push(null as any);
      return {
        type: hasNull ? ["string", "null"] : "string",
        enum: enumValues,
      };
    }

    const allNumberLiterals = nonNullish.every(
      (t) => t.flags & ts.TypeFlags.NumberLiteral
    );
    if (allNumberLiterals) {
      const enumValues = nonNullish.map(
        (t) => (t as ts.NumberLiteralType).value
      );
      if (hasNull) enumValues.push(null as any);
      return {
        type: hasNull ? ["number", "null"] : "number",
        enum: enumValues,
      };
    }

    // 4. Complex Unions (Fallback)
    const oneOf: any[] = nonNullish.map((t) => typeToSchema(checker, t));
    if (hasNull) oneOf.push({ type: "null" });
    return { oneOf };
  }

  // ─── Arrays & Streams ─────────────────────────────────────────────────────
  if (checker.isArrayType(type)) {
    const el = checker.getTypeArguments(type as ts.TypeReference)[0];
    return { type: "array", items: el ? typeToSchema(checker, el) : {} };
  }

  if (isAsyncIteratorType(type)) {
    const yieldType = checker.getTypeArguments(type as ts.TypeReference)[0];
    return {
      type: "array",
      items: yieldType ? typeToSchema(checker, yieldType) : {},
      "x-stream": true,
    };
  }

  // ─── Objects ──────────────────────────────────────────────────────────────
  const props = checker.getPropertiesOfType(type);
  if (props.length === 0) return {};

  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const prop of props) {
    if (prop.name.startsWith("__")) continue; // Skip internal brand markers
    properties[prop.name] = typeToSchema(
      checker,
      checker.getTypeOfSymbol(prop)
    );
    if (!(prop.flags & ts.SymbolFlags.Optional)) required.push(prop.name);
  }

  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}

// ─── JSDoc extraction ─────────────────────────────────────────────────────────

interface JsDocInfo {
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

/**
 * Extract JSDoc summary, description, and deprecated tag from a symbol.
 * Only works on symbols with source declarations — projected types lose JSDoc.
 */
function extractJsDoc(checker: ts.TypeChecker, symbol: ts.Symbol): JsDocInfo {
  const decl = symbol.declarations?.[0];
  if (!decl) return {};
  const tags = ts.getJSDocTags(decl);
  const deprecated = tags.some((t) => t.tagName.text === "deprecated");
  const text = ts
    .displayPartsToString(symbol.getDocumentationComment(checker))
    .trim();
  if (!text) return { deprecated };
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    summary: lines[0],
    description: lines.slice(1).join("\n").trim() || undefined,
    deprecated,
  };
}

// ─── Route extraction ─────────────────────────────────────────────────────────

export interface RouteInfo {
  path: string;
  method: "get" | "post";
  kind: "query" | "mutation" | "stream";
  input: object;
  output: object;
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

/**
 * Unwrap `() => Promise<R> & { __kind, __input }`:
 * - __kind and __input live on the Promise intersection, not inside R
 * - output schema comes from R — the Promise type argument
 * - kind defaults to "query" if __kind is absent (plain return handler)
 */
function unwrapReturnType(
  checker: ts.TypeChecker,
  ret: ts.Type
): {
  kind: "query" | "mutation" | "stream";
  input: object;
  outputType: ts.Type;
} {
  const kindProp = ret.getProperty("__kind");
  const kind: "query" | "mutation" | "stream" = kindProp
    ? ((checker.getTypeOfSymbol(kindProp) as ts.StringLiteralType).value as
        | "query"
        | "mutation"
        | "stream")
    : "query";

  const inputProp = ret.getProperty("__input");
  const inputType = inputProp ? checker.getTypeOfSymbol(inputProp) : null;
  // __input: undefined means no-arg handler — emit empty schema
  const input =
    inputType && !(inputType.flags & ts.TypeFlags.Undefined)
      ? typeToSchema(checker, inputType)
      : {};

  // Walk intersection constituents to find Promise<R> and extract R
  let outputType: ts.Type = ret;
  const constituents = (ret as ts.IntersectionType).types ?? [ret];
  const promisePart = constituents.find((t) => t.symbol?.name === "Promise");
  if (promisePart) {
    outputType =
      checker.getTypeArguments(promisePart as ts.TypeReference)[0] ??
      promisePart;
  }

  return { kind, input, outputType };
}

/**
 * Recursively walk the routes type tree, emitting a RouteInfo per callable.
 * Recurses into non-callable namespace objects.
 *
 * Invariant: callables are BrandedClientFns whose return type carries
 * __kind and __input on the Promise intersection.
 */
function extractRoutes(
  checker: ts.TypeChecker,
  type: ts.Type,
  prefix = ""
): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const prop of checker.getPropertiesOfType(type)) {
    const propType = checker.getTypeOfSymbol(prop);
    const path = prefix ? `${prefix}/${prop.name}` : prop.name;
    const sigs = propType.getCallSignatures();

    if (sigs.length > 0) {
      // Callable — route handler
      const ret = checker.getReturnTypeOfSignature(sigs[0]);
      const { kind, input, outputType } = unwrapReturnType(checker, ret);
      const { summary, description, deprecated } = extractJsDoc(checker, prop);

      routes.push({
        path,
        method: kind === "mutation" || kind === "stream" ? "post" : "get",
        kind,
        input,
        output: typeToSchema(checker, outputType),
        summary,
        description,
        deprecated,
      });
    } else {
      // Non-callable — namespace, recurse
      routes.push(...extractRoutes(checker, propType, path));
    }
  }

  return routes;
}

// ─── OpenAPI spec builder ─────────────────────────────────────────────────────

export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: { url: string }[];
  tags?: { name: string; description: string }[];
  paths: Record<string, object>;
}

export interface OpenApiResult {
  spec: OpenApiSpec;
  routes: RouteInfo[];
}

/**
 * Build OpenAPI `parameters` array from a JSON Schema object for GET routes.
 * Each top-level property becomes an individual `in: query` parameter.
 */
function buildQueryParams(
  input: object
): Array<{ name: string; in: string; schema: object; required: boolean }> {
  const schema = input as {
    properties?: Record<string, object>;
    required?: string[];
  };
  if (!schema.properties) return [];
  return Object.entries(schema.properties).map(([name, propSchema]) => ({
    name,
    in: "query",
    schema: propSchema,
    required: (schema.required ?? []).includes(name),
  }));
}

/**
 * Extract OpenAPI spec from a compiled app file.
 * Reads `export type App` and walks ctx.routes type tree.
 *
 * Assumption: App is `Promise<{ ctx: { ___routes: ClientRoutes<R> } }>`.
 */
/**
 * Extract OpenAPI spec from a compiled app file.
 * Reads `export type App` and walks ctx.routes type tree.
 *
 * Assumption: App is `Promise<{ ctx: { ___routes: ClientRoutes<R> } }>`.
 */
export function extractOpenApi(
  appFile: string,
  opts: {
    info: { title: string; version: string; description?: string };
    servers?: { url: string }[];
    excludePaths?: string[];
    tags?: { name: string; description: string }[];
  }
): OpenApiResult {
  const program = ts.createProgram([appFile], {
    strict: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(appFile);
  if (!source) throw new Error(`[openapi] file not found: ${appFile}`);

  // Find `export type App`
  let appType: ts.Type | null = null;
  ts.forEachChild(source, (node) => {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === "App" &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      appType = checker.getTypeAtLocation(node.type);
    }
  });
  if (!appType)
    throw new Error(`[openapi] "export type App" not found in ${appFile}`);

  // Unwrap Promise<{ ctx }> → ctx → routes
  const awaitedCtx = checker.getTypeArguments(appType as ts.TypeReference)?.[0];
  const ctxType = checker.getTypeOfSymbol(awaitedCtx?.getProperty("ctx")!);
  const routesType = checker.getTypeOfSymbol(
    ctxType?.getProperty("___routes")!
  );

  const excluded = new Set(opts.excludePaths ?? ["openapi"]);
  const routes = extractRoutes(checker, routesType).filter(
    (r) => !excluded.has(r.path)
  );

  // Build paths
  const paths: Record<string, object> = {};
  for (const r of routes) {
    const hasInput = Object.keys(r.input).length > 0;
    const inputSchema = !hasInput
      ? {}
      : r.method === "get"
      ? { parameters: buildQueryParams(r.input) }
      : {
          requestBody: {
            required: true,
            content: { "application/json": { schema: r.input } },
          },
        };

    // ─── 🌟 New DX Feature: Auto-generated Client Snippet ───────────────
    // ─── 🌟 New DX Feature: Auto-generated Client Snippets ───────────────

    // Convert "users/settings/update" -> "users.settings.update"
    const clientDotPath = r.path.split("/").join(".");
    const payloadArg = hasInput ? "data" : "";

    // 1. Short version for the Title (Summary)
    const clientCallShort = `api.${clientDotPath}.${r.kind}(${payloadArg})`;
    const combinedSummary = r.summary
      ? `${r.summary} (${clientCallShort})`
      : clientCallShort;

    // 2. Markdown version for the expanded Description
    const clientSnippet = `**Client Call:**\n\`\`\`typescript\n${clientCallShort}\n\`\`\``;
    const combinedDescription = r.description
      ? `${r.description}\n\n${clientSnippet}`
      : clientSnippet;

    // ────────────────────────────────────────────────────────────────────

    paths[`/${r.path}`] = {
      [r.method]: {
        operationId: r.path.split("/").join("_"),
        tags: [r.path.split("/")[0]],
        "x-kind": r.kind,
        summary: combinedSummary, // 👈 Inject the augmented title here
        description: combinedDescription, // 👈 Inject the augmented description here
        ...(r.deprecated ? { deprecated: true } : {}),
        ...inputSchema,
        responses: {
          "200": {
            description: "Success",
            content: { "application/json": { schema: r.output } },
          },
          "400": { description: "Validation error" },
          "500": { description: "Internal server error" },
        },
      },
    };
  }

  return {
    spec: {
      openapi: "3.1.0",
      info: opts.info,
      servers: opts.servers ?? [],
      ...(opts.tags?.length ? { tags: opts.tags } : {}),
      paths,
    },
    routes,
  };
}
