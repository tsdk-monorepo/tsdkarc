// codegen/openapi-to-routes.ts

import { readFileSync, writeFileSync } from "fs";
import { schemaToZodString } from "./schema-to-zod";
import { schemaToMock } from "./schema-to-mock";

// ─── OpenAPI types ────────────────────────────────────────────────────────────

interface OpenApiSpec {
  openapi: string;
  paths?: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    parameters?: Record<string, Parameter>;
    requestBodies?: Record<string, RequestBody>;
  };
}

interface PathItem {
  parameters?: (Parameter | Ref)[];
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: (Parameter | Ref)[];
  requestBody?: RequestBody | Ref;
  responses?: Record<string, Response | Ref>;
  tags?: string[];
}

interface RequestBody {
  required?: boolean;
  content?: Record<string, { schema?: JsonSchema }>;
}

interface Response {
  description?: string;
  content?: Record<string, { schema?: JsonSchema }>;
}

interface Ref {
  $ref: string;
}

interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: JsonSchema;
  description?: string;
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  enum?: unknown[];
  $ref?: string;
  nullable?: boolean;
  format?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: JsonSchema | boolean;
};

// ─── Options ──────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  moduleName: string;
  mode: "mock" | "proxy" | "both";
  baseUrl?: string;
  adapterImport?: string;
  excludePaths?: string[];
}

// ─── $ref resolution ─────────────────────────────────────────────────────────

/**
 * Resolve any $ref pointer within the spec by traversing the path segments.
 * Supports any #/ local ref — components/schemas, components/parameters, etc.
 */
function resolveRef<T>(spec: OpenApiSpec, ref: string): T {
  const parts = ref.replace("#/", "").split("/");
  let current: any = spec;
  for (const part of parts) {
    current =
      current?.[
        decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"))
      ];
  }
  return current as T;
}

function isRef(x: unknown): x is Ref {
  return typeof x === "object" && x !== null && "$ref" in x;
}

/**
 * Resolve $ref on a Parameter object.
 */
function resolveParameter(spec: OpenApiSpec, p: Parameter | Ref): Parameter {
  if (isRef(p)) return resolveRef<Parameter>(spec, p.$ref);
  return p;
}

/**
 * Resolve $ref on a RequestBody object.
 */
function resolveRequestBody(
  spec: OpenApiSpec,
  rb: RequestBody | Ref
): RequestBody {
  if (isRef(rb)) return resolveRef<RequestBody>(spec, rb.$ref);
  return rb;
}

/**
 * Recursively resolve all $ref in a JSON Schema.
 * Tracks visited refs to prevent infinite recursion on circular schemas.
 */
function resolveSchema(
  spec: OpenApiSpec,
  schema: JsonSchema,
  visited = new Set<string>()
): JsonSchema {
  if (!schema) return {};

  if (schema.$ref) {
    if (visited.has(schema.$ref)) {
      // Circular ref — break cycle with unknown
      return {};
    }
    visited = new Set(visited).add(schema.$ref);
    return resolveSchema(
      spec,
      resolveRef<JsonSchema>(spec, schema.$ref),
      visited
    );
  }

  const resolved: JsonSchema = { ...schema };

  if (schema.properties) {
    resolved.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [
        k,
        resolveSchema(spec, v, visited),
      ])
    );
  }
  if (schema.items) {
    resolved.items = resolveSchema(spec, schema.items, visited);
  }
  if (schema.oneOf) {
    resolved.oneOf = schema.oneOf.map((s) => resolveSchema(spec, s, visited));
  }
  if (schema.anyOf) {
    resolved.anyOf = schema.anyOf.map((s) => resolveSchema(spec, s, visited));
  }
  if (schema.allOf) {
    resolved.allOf = schema.allOf.map((s) => resolveSchema(spec, s, visited));
  }
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    resolved.additionalProperties = resolveSchema(
      spec,
      schema.additionalProperties,
      visited
    );
  }

  return resolved;
}

// ─── String helpers ───────────────────────────────────────────────────────────

function camelCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((l) => (l.trim() ? pad + l : l))
    .join("\n");
}

// ─── Method → semantic key ────────────────────────────────────────────────────

function methodToKey(
  method: "get" | "post" | "put" | "patch" | "delete",
  hasPathParams: boolean
): string {
  switch (method) {
    case "get":
      return hasPathParams ? "get" : "list";
    case "post":
      return "create";
    case "put":
      return "update";
    case "patch":
      return "patch";
    case "delete":
      return "remove";
  }
}

// ─── Route parsing ────────────────────────────────────────────────────────────

interface ParsedRoute {
  namespace: string | null;
  handlerKey: string;
  originalPath: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  kind: "query" | "mutate";
  operation: Operation;
  parameters: Parameter[];
  bodySchema: JsonSchema | null;
  responseSchema: JsonSchema | null;
  pathParams: string[];
}

/**
 * Find first successful (2xx) response schema from an operation.
 */
function findResponseSchema(
  spec: OpenApiSpec,
  operation: Operation
): JsonSchema | null {
  for (const code of ["200", "201", "202", "204"]) {
    const resp = operation.responses?.[code];
    if (!resp) continue;
    const resolved = isRef(resp) ? resolveRef<Response>(spec, resp.$ref) : resp;
    const schema = resolved.content?.["application/json"]?.schema;
    if (schema) return resolveSchema(spec, schema);
  }
  return null;
}

/**
 * Parse a single OpenAPI path + method into a ParsedRoute.
 *
 * Handler key derivation:
 * - Static segments beyond the first become the handler key
 * - Dynamic {param} segments are skipped for key building
 * - Falls back to method-derived key (list/get/create/update/patch/remove)
 *
 * Path params are merged into the input schema alongside query params.
 */
function parsePath(
  spec: OpenApiSpec,
  path: string,
  pathItemParams: Parameter[],
  method: "get" | "post" | "put" | "patch" | "delete",
  operation: Operation
): ParsedRoute {
  const segments = path.replace(/^\//, "").split("/");

  const pathParams = segments
    .filter((s) => s.startsWith("{") && s.endsWith("}"))
    .map((s) => s.slice(1, -1));

  const staticSegments = segments.filter(
    (s) => !s.startsWith("{") && !s.endsWith("}")
  );

  const namespace = staticSegments.length > 1 ? staticSegments[0] : null;

  const subSegments =
    staticSegments.length > 1 ? staticSegments.slice(1) : staticSegments;

  // Use sub-segment as key if available, else fall back to method key
  const rawKey =
    subSegments.length >= 1 && subSegments[0]
      ? subSegments.join("_")
      : methodToKey(method, pathParams.length > 0);

  const handlerKey = camelCase(rawKey);

  // Merge path-level params + operation params, operation wins on name collision
  const opParams = (operation.parameters ?? []).map((p) =>
    resolveParameter(spec, p)
  );
  const pathLevelParams = pathItemParams.filter(
    (p) => !opParams.find((op) => op.name === p.name)
  );
  const parameters = [...pathLevelParams, ...opParams].filter(
    (p) => p.in === "path" || p.in === "query"
  );

  // Resolve requestBody
  const rb = operation.requestBody
    ? resolveRequestBody(spec, operation.requestBody)
    : null;
  const bodySchema = rb?.content?.["application/json"]?.schema
    ? resolveSchema(spec, rb.content["application/json"].schema!)
    : null;

  const responseSchema = findResponseSchema(spec, operation);

  return {
    namespace,
    handlerKey,
    originalPath: path,
    method,
    kind: method === "get" ? "query" : "mutate",
    operation,
    parameters,
    bodySchema,
    responseSchema,
    pathParams,
  };
}

// ─── Input schema builder ─────────────────────────────────────────────────────

/**
 * Merge path params + query params + body fields into one input schema.
 * Returns null only if the route has absolutely no input.
 */
function buildInputSchema(route: ParsedRoute): JsonSchema | null {
  const props: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const p of route.parameters) {
    props[p.name] = p.schema ?? { type: "string" };
    if (p.required || p.in === "path") required.push(p.name);
  }

  if (route.bodySchema?.properties) {
    for (const [k, v] of Object.entries(route.bodySchema.properties)) {
      if (!(k in props)) props[k] = v;
      if (route.bodySchema.required?.includes(k)) required.push(k);
    }
  }

  if (Object.keys(props).length === 0) return null;

  return {
    type: "object",
    properties: props,
    ...(required.length ? { required } : {}),
  };
}

// ─── Proxy URL builder ────────────────────────────────────────────────────────

/**
 * Generate the proxy URL expression string.
 * baseUrl is a raw string embedded directly — no ${} wrapping.
 */
function buildProxyUrlExpr(
  originalPath: string,
  queryParams: string[],
  baseUrl: string
): string {
  const pathExpr = originalPath.replace(
    /\{(\w+)\}/g,
    (_: string, name: string) => `\${data.${name}}`
  );

  if (queryParams.length === 0) {
    return `\`${baseUrl}${pathExpr}\``;
  }

  const qsLines = queryParams
    .map((p) => `    params.set(${JSON.stringify(p)}, String(data.${p}));`)
    .join("\n");

  return `(() => {
  const params = new URLSearchParams();
${qsLines}
  return \`${baseUrl}${pathExpr}?\${params}\`;
})()`;
}

// ─── Handler codegen ──────────────────────────────────────────────────────────

/**
 * Generate the body of a single route handler function.
 */
function generateHandlerBody(
  route: ParsedRoute,
  mode: "mock" | "proxy",
  baseUrl: string
): string {
  const inputSchema = buildInputSchema(route);
  const zodArg = inputSchema ? schemaToZodString(inputSchema) : null;

  const mockValue = route.responseSchema
    ? JSON.stringify(schemaToMock(route.responseSchema), null, 2)
    : "null";

  const queryParams = route.parameters
    .filter((p) => p.in === "query")
    .map((p) => p.name);

  const helperCall = route.kind === "query" ? "ctx.query" : "ctx.mutate";

  const jsdocLines = [
    route.operation.summary ? ` * ${route.operation.summary}` : null,
    route.operation.description ? ` * ${route.operation.description}` : null,
    route.operation.deprecated ? " * @deprecated" : null,
  ].filter(Boolean);

  const jsdoc = jsdocLines.length ? `/**\n${jsdocLines.join("\n")}\n */\n` : "";

  // ── no input ───────────────────────────────────────────────────────────────
  if (!zodArg) {
    if (mode === "mock") {
      return `${jsdoc}${route.handlerKey}(ctx) {
  return ${mockValue};
}`;
    }
    const proxyCall =
      route.method === "get"
        ? `proxyGet(\`${baseUrl}${route.originalPath}\`)`
        : `proxyPost(\`${baseUrl}${route.originalPath}\`, {})`;
    return `${jsdoc}${route.handlerKey}(ctx) {
  return ${helperCall}(() => ${proxyCall});
}`;
  }

  // ── has input ──────────────────────────────────────────────────────────────
  if (mode === "mock") {
    return `${jsdoc}${route.handlerKey}(ctx) {
  return ${helperCall}(
    ${zodArg},
    (_data) => {
      return ${mockValue}
    }
  );
}`;
  }

  const proxyUrlExpr = buildProxyUrlExpr(
    route.originalPath,
    queryParams,
    baseUrl
  );
  const proxyFetchExpr =
    route.method === "get"
      ? `proxyGet(${proxyUrlExpr})`
      : `proxyPost(${proxyUrlExpr}, data)`;

  return `${jsdoc}${route.handlerKey}(ctx) {
  return ${helperCall}(
    ${zodArg},
    (data) => ${proxyFetchExpr}
  );
}`;
}

// ─── Route grouping ───────────────────────────────────────────────────────────

interface RouteGroup {
  namespace: string | null;
  ___routes: ParsedRoute[];
}

/**
 * Group parsed routes by namespace.
 * Detects handlerKey collisions within the null-namespace group and
 * promotes the first path segment to namespace to resolve them.
 */
function groupRoutes(routes: ParsedRoute[]): RouteGroup[] {
  const nullRoutes = routes.filter((r) => r.namespace === null);
  const keys = nullRoutes.map((r) => r.handlerKey);
  const hasCollision = new Set(keys).size !== keys.length;

  if (hasCollision) {
    for (const r of nullRoutes) {
      const firstSegment = r.originalPath.replace(/^\//, "").split("/")[0];
      r.namespace = firstSegment;
      r.handlerKey = methodToKey(r.method, r.pathParams.length > 0);
    }
  }

  // Detect remaining collisions within each namespace and suffix with method
  const map = new Map<string | null, ParsedRoute[]>();
  for (const r of routes) {
    if (!map.has(r.namespace)) map.set(r.namespace, []);
    map.get(r.namespace)!.push(r);
  }

  for (const [, group] of map) {
    const groupKeys = group.map((r) => r.handlerKey);
    const hasDup = new Set(groupKeys).size !== groupKeys.length;
    if (hasDup) {
      // Suffix with method to guarantee uniqueness
      for (const r of group) {
        const methodSuffix =
          r.method.charAt(0).toUpperCase() + r.method.slice(1);
        r.handlerKey = `${r.handlerKey}${methodSuffix}`;
      }
    }
  }

  return [...map.entries()].map(([namespace, ___routes]) => ({
    namespace,
    ___routes,
  }));
}

// ─── Module codegen ───────────────────────────────────────────────────────────

function generateModule(
  groups: RouteGroup[],
  moduleName: string,
  mode: "mock" | "proxy",
  baseUrl: string
): string {
  const routeEntries = groups
    .map((group) => {
      const handlers = group.___routes
        .map((r) =>
          indent(generateHandlerBody(r, mode, baseUrl), group.namespace ? 4 : 2)
        )
        .join(",\n\n");

      if (group.namespace === null) return handlers;
      return `  ${group.namespace}: {\n${handlers}\n  }`;
    })
    .join(",\n\n");

  const exportName = mode === "proxy" ? `${moduleName}Proxy` : moduleName;

  return `export const ${exportName} = defineRouter()({
${routeEntries}
});`;
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate a tsdkarc-x routes .ts file from an OpenAPI 3.1 spec.
 *
 * Handles:
 * - $ref resolution for schemas, parameters, requestBodies (with circular guard)
 * - Path-level shared parameters merged with operation parameters
 * - Path params merged into input schema alongside query params
 * - allOf / oneOf / anyOf composition
 * - additionalProperties → z.record()
 * - Null-namespace collision detection → namespace promotion
 * - Remaining collision resolution via method suffix
 * - 201/202/204 response schemas
 * - mock mode: returns generated values from response schema
 * - proxy mode: forwards to real API, rebuilds URL from input
 * - both: generates two named exports in one file
 */
export function generateFromOpenApi(
  specPath: string,
  opts: GenerateOptions
): string {
  const raw = readFileSync(specPath, "utf-8");
  const spec: OpenApiSpec = JSON.parse(raw);

  if (opts.mode !== "mock" && !opts.baseUrl) {
    throw new Error("[codegen] baseUrl is required for proxy and both modes");
  }

  const baseUrl = opts.baseUrl ?? "";
  const excluded = new Set(opts.excludePaths ?? []);
  const adapterImport = opts.adapterImport ?? "../adapters/app.hono";
  const methods = ["get", "post", "put", "patch", "delete"] as const;

  const parsed: ParsedRoute[] = [];

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (excluded.has(path)) continue;

    // Resolve path-level shared parameters once per path
    const pathLevelParams = (item.parameters ?? []).map((p) =>
      resolveParameter(spec, p)
    );

    for (const method of methods) {
      const op = item[method];
      if (!op) continue;
      parsed.push(parsePath(spec, path, pathLevelParams, method, op));
    }
  }

  const groups = groupRoutes(parsed);
  const needsZod = parsed.some((r) => buildInputSchema(r) !== null);
  const needsProxy = opts.mode === "proxy" || opts.mode === "both";

  const imports = [
    `import { defineRouter } from ${JSON.stringify(adapterImport)};`,
    needsZod ? `import { z } from "zod";` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const proxyHelpers = needsProxy
    ? `
// ─── Proxy fetch helpers ──────────────────────────────────────────────────────

async function proxyGet(url: string): Promise<unknown> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok)
    throw Object.assign(
      new Error(\`[proxy] GET \${url} → HTTP \${res.status}\`),
      { status: res.status }
    );
  return res.json();
}

async function proxyPost(url: string, data: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
  if (!res.ok)
    throw Object.assign(
      new Error(\`[proxy] POST \${url} → HTTP \${res.status}\`),
      { status: res.status }
    );
  return res.json();
}
`
    : "";

  const blocks: string[] = [];
  if (opts.mode === "mock" || opts.mode === "both") {
    blocks.push(generateModule(groups, opts.moduleName, "mock", baseUrl));
  }
  if (opts.mode === "proxy" || opts.mode === "both") {
    blocks.push(generateModule(groups, opts.moduleName, "proxy", baseUrl));
  }

  return [
    `// ─── Generated by tsdkarc-x openapi codegen ─────────────────────────────────`,
    `// Source: ${specPath}`,
    `// Mode:   ${opts.mode}`,
    `// Do not edit manually — regenerate with generateFromOpenApi()`,
    ``,
    imports,
    proxyHelpers,
    ...blocks,
  ]
    .join("\n")
    .trim();
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

/**
 * Generate a routes file and write it to disk.
 */
export function generateAndWrite(
  specPath: string,
  outputPath: string,
  opts: GenerateOptions
) {
  const source = generateFromOpenApi(specPath, opts);
  writeFileSync(outputPath, source, "utf-8");
  console.log(`[codegen] written to ${outputPath}`);
}
