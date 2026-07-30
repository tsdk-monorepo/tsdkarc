// extract-types.ts
//
// Generates static .d.ts files for the core Client, SWR, React Query, and Vue Query.
// Completely eliminates generic mapped types for O(1) autocomplete speed.
// Extracts original JSDoc comments and creates clickable source file links.
//
// Performance optimizations:
//   1. WeakMap cache for zod schema → TS type conversion (avoids redundant z.toJSONSchema calls)
//   2. ts.Program cache keyed by root files + tsconfig (avoids ~100-500ms re-creation on repeat calls)
//   3. Single tree build shared across all four DTS flavors (4× traversal → 1×)

import ts from "typescript";
import { z } from "zod";
import type { ZodType } from "zod";
import type { RuntimeRouteTree } from "../types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExtractTypesOptions {
  exportName?: string;
}

export interface SourceEnrichOptions {
  entryFile: string;
  routesExportName?: string;
  tsConfigFilePath?: string;
  includeSourceLocation?: boolean;
}

export interface ExtractTypesResult {
  clientDts: string;
  swrDts: string;
  reactQueryDts: string;
  vueQueryDts: string;
  paths: string[];
}

// ─── Internal constants ───────────────────────────────────────────────────────

const ROUTE_KINDS = new Set([
  "query",
  "mutate",
  "stream",
  "upload",
  "plain",
] as const);

type RouteKind = "query" | "mutate" | "stream" | "upload" | "plain";

const HANDLER_METHODS = new Set(["query", "mutate", "stream", "upload"]);

interface NormalisedRoute {
  _kind: RouteKind;
  schema?: ZodType;
}

interface FlatRoute {
  path: string;
  kind: RouteKind;
  inputTs: string | null;
  outputTs: string;
  docs?: string;
  location?: string;
}

// ─── Route leaf detection ─────────────────────────────────────────────────────

function isRouteLeaf(node: unknown): node is NormalisedRoute {
  return (
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    "_kind" in node &&
    ROUTE_KINDS.has((node as any)._kind)
  );
}

// ─── instanceof class name extraction ────────────────────────────────────────

function unwrapModifiers(schema: ZodType): ZodType {
  const s = schema as any;
  if (typeof s.unwrap === "function") return unwrapModifiers(s.unwrap());
  if (typeof s.removeDefault === "function")
    return unwrapModifiers(s.removeDefault());
  return schema;
}

function getInstanceofClassName(schema: ZodType): string | null {
  const cls = (schema as any)?._zod?.bag?.Class;
  if (typeof cls === "function" && cls.name) return cls.name;
  return null;
}

function collectInstanceofHints(schema: ZodType): Map<string, string> {
  const hints = new Map<string, string>();
  const shape = (schema as any).shape;
  if (!shape || typeof shape !== "object") return hints;

  for (const [key, fieldSchema] of Object.entries(
    shape as Record<string, ZodType>
  )) {
    const inner = unwrapModifiers(fieldSchema);
    const name = getInstanceofClassName(inner);
    if (name) hints.set(key, name);
  }

  return hints;
}

// ─── JSON Schema → TypeScript type string ────────────────────────────────────

function jsonSchemaToTs(
  node: Record<string, any>,
  propertyKey: string | null,
  instanceofHints: Map<string, string>
): string {
  if (Object.keys(node).length === 0) {
    if (propertyKey !== null && instanceofHints.has(propertyKey)) {
      return instanceofHints.get(propertyKey)!;
    }
    return "unknown";
  }

  if (Array.isArray(node.anyOf)) {
    return node.anyOf
      .map((n: any) => jsonSchemaToTs(n, null, instanceofHints))
      .join(" | ");
  }
  if (Array.isArray(node.allOf)) {
    return node.allOf
      .map((n: any) => jsonSchemaToTs(n, null, instanceofHints))
      .join(" & ");
  }
  if (Array.isArray(node.oneOf)) {
    return node.oneOf
      .map((n: any) => jsonSchemaToTs(n, null, instanceofHints))
      .join(" | ");
  }
  if (Array.isArray(node.enum)) {
    return (node.enum as unknown[]).map((v) => JSON.stringify(v)).join(" | ");
  }
  if ("const" in node) {
    return JSON.stringify(node.const);
  }

  switch (node.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";

    case "array": {
      if (Array.isArray(node.prefixItems)) {
        const items = (node.prefixItems as any[]).map((n) =>
          jsonSchemaToTs(n, null, instanceofHints)
        );
        return `[${items.join(", ")}]`;
      }
      const itemType = node.items
        ? jsonSchemaToTs(node.items, null, instanceofHints)
        : "unknown";
      return `Array<${itemType}>`;
    }

    case "object": {
      const props = node.properties as Record<string, any> | undefined;
      if (!props || Object.keys(props).length === 0) {
        if (
          node.additionalProperties &&
          typeof node.additionalProperties === "object"
        ) {
          return `Record<string, ${jsonSchemaToTs(
            node.additionalProperties,
            null,
            instanceofHints
          )}>`;
        }
        return "Record<string, unknown>";
      }
      const required: string[] = Array.isArray(node.required)
        ? node.required
        : [];
      const fields = Object.entries(props).map(([key, propNode]) => {
        const tsType = jsonSchemaToTs(propNode, key, instanceofHints);
        const optional = !required.includes(key) || "default" in propNode;
        return `${key}${optional ? "?" : ""}: ${tsType}`;
      });
      return `{ ${fields.join("; ")} }`;
    }

    default:
      if (Array.isArray(node.type)) {
        return (node.type as string[])
          .map((t) => jsonSchemaToTs({ type: t }, null, instanceofHints))
          .join(" | ");
      }
      return "unknown";
  }
}

/**
 * WeakMap cache for zod schema → TS type string conversion.
 * Same schema object identity = same result, so we skip z.toJSONSchema re-traversal.
 * WeakMap ensures no memory leak when schema objects are GC'd.
 */
const zodSchemaTsCache = new WeakMap<ZodType, string>();

function zodSchemaToTs(schema: ZodType): string {
  const cached = zodSchemaTsCache.get(schema);
  if (cached !== undefined) return cached;

  const hints = collectInstanceofHints(schema);
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema, {
    unrepresentable: "any",
  }) as any;
  const result = jsonSchemaToTs(jsonSchema, null, hints);

  zodSchemaTsCache.set(schema, result);
  return result;
}

// ─── Phase 1: Runtime tree walk ───────────────────────────────────────────────

function collectRoutes(tree: RuntimeRouteTree, prefix = ""): FlatRoute[] {
  const result: FlatRoute[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${key}` : key;

    if (isRouteLeaf(value)) {
      result.push({
        path,
        kind: value._kind,
        inputTs: value.schema ? zodSchemaToTs(value.schema) : null,
        outputTs: "unknown",
      });
    } else if (typeof value === "object" && value !== null) {
      result.push(...collectRoutes(value as RuntimeRouteTree, path));
    }
  }

  return result;
}

// ─── Phase 2: TypeScript compiler API — program cache ────────────────────────

interface CompilerSetup {
  options: ts.CompilerOptions;
  /** All files that should be roots of the program. Includes tsconfig fileNames + entryFile. */
  rootFiles: string[];
}

/**
 * Parse tsconfig and return both compiler options and all included file names.
 * Using only [entryFile] as roots causes getTypeAtLocation to give `unknown`
 * for nodes in transitively-imported files because the checker won't fully
 * elaborate generics there. Including all tsconfig roots fixes this.
 */
function resolveCompilerSetup(
  entryFile: string,
  tsConfigFilePath?: string,
  tsBuildInfoFile?: string
): CompilerSetup {
  const incrementalOptions: ts.CompilerOptions = {
    incremental: true,
    tsBuildInfoFile: tsBuildInfoFile ?? "./.tsbuildinfo-codegen",
  };

  if (tsConfigFilePath) {
    const configFile = ts.readConfigFile(tsConfigFilePath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      tsConfigFilePath.replace(/[/\\]tsconfig\.json$/, "")
    );
    const normalEntry = entryFile.replace(/\\/g, "/");
    const rootFiles = [
      ...new Set([
        normalEntry,
        ...parsed.fileNames.map((f) => f.replace(/\\/g, "/")),
      ]),
    ];
    return {
      options: { ...parsed.options, ...incrementalOptions },
      rootFiles,
    };
  }

  return {
    options: {
      strict: true,
      target: ts.ScriptTarget.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      ...incrementalOptions,
    },
    rootFiles: [entryFile],
  };
}

interface CachedProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  /** Stable key: sorted root file paths joined with pipe. */
  rootFilesKey: string;
  tsConfigFilePath: string | undefined;
}

/**
 * Module-level program cache.
 * ts.createProgram is the single most expensive operation here (~100–500ms).
 * Safe to reuse within one server boot; call invalidateProgramCache() on file changes.
 */
let programCache: CachedProgram | null = null;

/**
 * Return a cached ts.Program/checker pair when inputs are unchanged.
 * Invalidates automatically when root files or tsconfig path differs.
 */
function getOrCreateProgram(
  entryFile: string,
  tsConfigFilePath?: string,
  tsBuildInfoFile?: string
): { program: ts.Program; checker: ts.TypeChecker } {
  const { options, rootFiles } = resolveCompilerSetup(
    entryFile,
    tsConfigFilePath,
    tsBuildInfoFile
  );
  const rootFilesKey = [...rootFiles].sort().join("|");

  if (
    programCache &&
    programCache.rootFilesKey === rootFilesKey &&
    programCache.tsConfigFilePath === tsConfigFilePath
  ) {
    return { program: programCache.program, checker: programCache.checker };
  }

  const builderProgram = ts.createIncrementalProgram({
    rootNames: rootFiles,
    options,
  });
  const program = builderProgram.getProgram();
  const checker = program.getTypeChecker();

  programCache = { program, checker, rootFilesKey, tsConfigFilePath };
  return { program, checker };
}

/**
 * Evict the program cache.
 * Call this in watch mode or after any source file changes.
 */
export function invalidateProgramCache() {
  programCache = null;
}

// ─── Phase 2: TypeScript compiler API — type resolution ──────────────────────

/**
 * TypeFormatFlags that preserve literal types, branded types, and satisfies-narrowed shapes.
 * Without NoTruncation the checker silently truncates long union types.
 */
const TYPE_FORMAT_FLAGS =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseFullyQualifiedType |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

function typeToString(type: ts.Type, checker: ts.TypeChecker): string {
  return checker.typeToString(type, undefined, TYPE_FORMAT_FLAGS);
}

/**
 * Unwrap Promise<T> or AsyncGenerator<T, ...> to T.
 * Handles fully-qualified names that appear when UseFullyQualifiedType flag is set.
 */
function unwrapReturnType(rawReturn: ts.Type, checker: ts.TypeChecker): string {
  const typeArgs = checker.getTypeArguments(rawReturn as ts.TypeReference);

  if (typeArgs.length > 0) {
    const sym = rawReturn.getSymbol();
    const symName = sym?.getName() ?? "";
    if (symName === "AsyncGenerator" || symName === "AsyncIterator") {
      return typeToString(typeArgs[0], checker);
    }
    if (symName === "Promise") {
      return typeToString(typeArgs[0], checker);
    }
  }

  const text = typeToString(rawReturn, checker);
  const asyncGenMatch = text.match(
    /^(?:globalThis\.)?AsyncGenerator<([\s\S]+)>$/
  );
  if (asyncGenMatch) {
    if (typeArgs.length > 0) return typeToString(typeArgs[0], checker);
  }
  const promiseMatch = text.match(/^(?:globalThis\.)?Promise<([\s\S]+)>$/);
  if (promiseMatch) {
    if (typeArgs.length > 0) return typeToString(typeArgs[0], checker);
  }

  return text;
}

/**
 * Resolve return type of a handler using multiple strategies in priority order.
 *
 * Strategy A — getTypeAtLocation on the handler node:
 *   Gives the handler's inferred function type. Return type is concrete from body.
 *   Most reliable when the handler is a standalone arrow.
 *
 * Strategy B — getContextualType on the handler node:
 *   Gives the expected function type from the outer generic call (r.mutate).
 *   The return type may still be a free type parameter if TOutput is inferred,
 *   so we reject it if it's a TypeParameter.
 *
 * Strategy C — walk the outer call's return type for an _output property:
 *   Some router implementations store TOutput on the route descriptor as _output.
 *   We look for properties named "_output", "output", "_result", "result".
 *
 * Strategy D — call getReturnTypeOfSignature on the outer call expression type:
 *   If the outer r.mutate() call itself is typed as returning Promise<TOutput>,
 *   we can extract TOutput from the call's return type arguments.
 */
function resolveOutputType(
  handlerNode: ts.Node,
  callNode: ts.CallExpression | undefined,
  checker: ts.TypeChecker
): string {
  // ── Strategy A: direct handler type ──────────────────────────────────────
  const handlerType = checker.getTypeAtLocation(handlerNode);
  const handlerSigs = handlerType.getCallSignatures();
  if (handlerSigs.length) {
    const retType = checker.getReturnTypeOfSignature(handlerSigs[0]);
    const unwrapped = unwrapReturnType(retType, checker);
    if (unwrapped !== "unknown" && unwrapped !== "any") return unwrapped;
  }

  if (!callNode) return "unknown";

  // ── Strategy B: contextual type from outer call ───────────────────────────
  const contextual = checker.getContextualType(handlerNode as ts.Expression);
  if (contextual) {
    const ctxSigs = contextual.getCallSignatures();
    if (ctxSigs.length) {
      const retType = checker.getReturnTypeOfSignature(ctxSigs[0]);
      if (!(retType.flags & ts.TypeFlags.TypeParameter)) {
        const candidate = unwrapReturnType(retType, checker);
        if (candidate !== "unknown" && candidate !== "any") return candidate;
      }
    }
  }

  // ── Strategy C: _output property on route descriptor ─────────────────────
  const OUTPUT_PROPS = ["_output", "output", "_result", "result"] as const;
  const callType = checker.getTypeAtLocation(callNode);
  for (const propName of OUTPUT_PROPS) {
    const prop = callType.getProperty(propName);
    if (prop) {
      const propType = checker.getTypeOfSymbol(prop);
      const candidate = typeToString(propType, checker);
      if (candidate !== "unknown" && candidate !== "any") return candidate;
    }
  }

  // ── Strategy D: type args of outer call's return type ────────────────────
  const callTypeArgs = checker.getTypeArguments(callType as ts.TypeReference);
  if (callTypeArgs.length >= 2) {
    const candidate = typeToString(callTypeArgs[1], checker);
    if (
      candidate !== "unknown" &&
      candidate !== "any" &&
      !(callTypeArgs[1].flags & ts.TypeFlags.TypeParameter)
    ) {
      return candidate;
    }
  }

  return "unknown";
}

/**
 * Extract the TypeScript type string for the first parameter of a callable node.
 * Tries the handler's own declared type first, then the contextual type.
 * Returns null if the param type is implicit any (no annotation).
 */
function extractFirstParamType(
  typeNode: ts.Node,
  checker: ts.TypeChecker
): string | null {
  const getParamTypeStr = (sig: ts.Signature): string | null => {
    const params = sig.getParameters();
    if (!params.length) return null;
    const paramType = checker.getTypeOfSymbol(params[0]);
    const paramTypeStr = typeToString(paramType, checker);
    if (paramTypeStr === "any") return null;
    return paramTypeStr;
  };

  const directSigs = checker.getTypeAtLocation(typeNode).getCallSignatures();
  if (directSigs.length) {
    const result = getParamTypeStr(directSigs[0]);
    if (result !== null) return result;
  }

  const contextual = checker.getContextualType(typeNode as ts.Expression);
  if (contextual) {
    const ctxSigs = contextual.getCallSignatures();
    if (ctxSigs.length) {
      const result = getParamTypeStr(ctxSigs[0]);
      if (result !== null) return result;
    }
  }

  return null;
}

interface ResolvedObject {
  node: ts.ObjectLiteralExpression;
  sf: ts.SourceFile;
}

/**
 * Find the initializer of a named variable export using the type checker symbol table.
 * Correctly handles re-exports and external module declarations,
 * unlike a raw AST walk which only sees the local file.
 */
function getExportedVarInitializerViaChecker(
  name: string,
  sf: ts.SourceFile,
  checker: ts.TypeChecker
): ts.Expression | null {
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer
        ) {
          return decl.initializer;
        }
      }
    }
  }

  const symbols = checker.getSymbolsInScope(sf, ts.SymbolFlags.Variable);
  for (const sym of symbols) {
    if (sym.name !== name) continue;
    let resolved = sym;
    if (resolved.flags & ts.SymbolFlags.Alias) {
      resolved = checker.getAliasedSymbol(resolved);
    }
    const decls = resolved.getDeclarations();
    if (!decls || !decls.length) continue;
    const decl = decls[0];
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      return decl.initializer;
    }
  }

  return null;
}

function resolveIdentifier(
  node: ts.Identifier,
  checker: ts.TypeChecker
): ResolvedObject | null {
  let symbol = checker.getSymbolAtLocation(node);

  // Shorthand property assignments return the property symbol by default.
  // Explicitly request the value symbol to chase the actual imported variable.
  if (
    node.parent &&
    ts.isShorthandPropertyAssignment(node.parent) &&
    node.parent.name === node
  ) {
    const valueSymbol = checker.getShorthandAssignmentValueSymbol(node.parent);
    if (valueSymbol) symbol = valueSymbol;
  }

  if (!symbol) return null;

  while (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }

  const decls = symbol.getDeclarations();
  if (!decls || decls.length === 0) return null;

  const decl = decls[0];

  if (ts.isVariableDeclaration(decl) && decl.initializer) {
    return resolveToObjectLiteral(
      decl.initializer,
      decl.getSourceFile(),
      checker
    );
  }

  if (ts.isExportAssignment(decl) && decl.expression) {
    return resolveToObjectLiteral(
      decl.expression,
      decl.getSourceFile(),
      checker
    );
  }

  if (ts.isImportSpecifier(decl) || ts.isImportClause(decl)) {
    const type = checker.getTypeAtLocation(decl);
    const valueDecl = type.symbol?.valueDeclaration;
    if (!valueDecl) return null;

    if (ts.isVariableDeclaration(valueDecl) && valueDecl.initializer) {
      return resolveToObjectLiteral(
        valueDecl.initializer,
        valueDecl.getSourceFile(),
        checker
      );
    }
    if (ts.isExportAssignment(valueDecl) && valueDecl.expression) {
      return resolveToObjectLiteral(
        valueDecl.expression,
        valueDecl.getSourceFile(),
        checker
      );
    }
  }

  return null;
}

function resolveToObjectLiteral(
  node: ts.Node,
  sf: ts.SourceFile,
  checker: ts.TypeChecker
): ResolvedObject | null {
  if (!node) return null;
  if (ts.isObjectLiteralExpression(node)) return { node, sf };
  if (ts.isParenthesizedExpression(node))
    return resolveToObjectLiteral(node.expression, sf, checker);
  if (ts.isIdentifier(node)) return resolveIdentifier(node, checker);

  if (ts.isPropertyAccessExpression(node)) {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol) {
      while (symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      const decls = symbol.getDeclarations();
      if (decls && decls.length > 0) {
        const decl = decls[0];
        if (ts.isVariableDeclaration(decl) && decl.initializer) {
          return resolveToObjectLiteral(
            decl.initializer,
            decl.getSourceFile(),
            checker
          );
        }
        if (ts.isPropertyAssignment(decl)) {
          return resolveToObjectLiteral(
            decl.initializer,
            decl.getSourceFile(),
            checker
          );
        }
        if (ts.isExportAssignment(decl) && decl.expression) {
          return resolveToObjectLiteral(
            decl.expression,
            decl.getSourceFile(),
            checker
          );
        }
      }
    }
  }

  if (ts.isAsExpression(node))
    return resolveToObjectLiteral(node.expression, sf, checker);
  if (ts.isSatisfiesExpression(node))
    return resolveToObjectLiteral(node.expression, sf, checker);
  if (ts.isCallExpression(node)) {
    const lastArg = node.arguments[node.arguments.length - 1];
    return lastArg ? resolveToObjectLiteral(lastArg, sf, checker) : null;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const body = node.body;
    if (ts.isParenthesizedExpression(body))
      return resolveToObjectLiteral(body.expression, sf, checker);
    if (ts.isObjectLiteralExpression(body)) return { node: body, sf };
    if (ts.isBlock(body)) {
      for (const stmt of body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression) {
          return resolveToObjectLiteral(stmt.expression, sf, checker);
        }
      }
    }
  }
  return null;
}

export interface SourceMeta {
  outputTs?: string;
  /** Inferred from handler first-param when no zod schema is present */
  inputTs?: string;
  docs: string;
  location: string;
}

interface SourceExtractionResult {
  leaves: Map<string, SourceMeta>;
  namespaces: Map<string, SourceMeta>;
}

function walkObjectLiteral(
  resolved: ResolvedObject,
  prefix: string,
  checker: ts.TypeChecker,
  out: SourceExtractionResult,
  options: SourceEnrichOptions
) {
  const { node, sf } = resolved;
  const includeLocation = options.includeSourceLocation !== false;

  for (const prop of node.properties) {
    let key: string | null = null;
    let val: ts.Node | null = null;
    let propNameNode: ts.Node = prop;

    // 1. Standard Property Assignment: `key: value`
    if (ts.isPropertyAssignment(prop)) {
      key = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;
      val = prop.initializer;
      propNameNode = prop.name;
    }
    // 2. ES6 Shorthand Property: `authRoutes,`
    else if (ts.isShorthandPropertyAssignment(prop)) {
      key = prop.name.text;
      val = prop.name;
      propNameNode = prop.name;
    }
    // 3. Spread Assignment: `...authRoutes`
    else if (ts.isSpreadAssignment(prop)) {
      const inner = resolveToObjectLiteral(prop.expression, sf, checker);
      if (inner) {
        walkObjectLiteral(inner, prefix, checker, out, options);
      }
      continue;
    } else {
      continue;
    }

    if (!key || !val) continue;

    const path = prefix ? `${prefix}/${key}` : key;
    let location: string = "";

    if (includeLocation) {
      const pos = sf.getLineAndCharacterOfPosition(propNameNode.getStart());
      const absolutePath = sf.fileName.replace(/\\/g, "/");
      location = `file://${
        absolutePath.startsWith("/") ? "" : "/"
      }${absolutePath}#${pos.line + 1}`;
    }

    let docs = "";
    const symbol = checker.getSymbolAtLocation(propNameNode);
    if (symbol) {
      docs = ts.displayPartsToString(symbol.getDocumentationComment(checker));
      const tags = symbol.getJsDocTags();
      if (tags.length) {
        docs +=
          (docs ? "\n" : "") +
          tags
            .map(
              (t) =>
                `@${t.name} ${t.text ? ts.displayPartsToString(t.text) : ""}`
            )
            .join("\n");
      }
    }

    const setOut = (handlerNode: ts.Node, callNode?: ts.CallExpression) => {
      const outputTs = resolveOutputType(handlerNode, callNode, checker);
      const inputTs = extractFirstParamType(handlerNode, checker);

      out.leaves.set(path, {
        outputTs,
        inputTs: inputTs ?? undefined,
        docs: docs.trim(),
        location,
      });
    };

    // r.query(handler) / r.mutate(schema, handler) / r.stream(...) / r.upload(...)
    if (
      ts.isCallExpression(val) &&
      ts.isPropertyAccessExpression(val.expression) &&
      HANDLER_METHODS.has(val.expression.name.text)
    ) {
      const args = val.arguments;
      const handler = args[args.length - 1];
      if (handler) setOut(handler, val);
      continue;
    }

    // Bare arrow/function (plain handler)
    if (ts.isArrowFunction(val) || ts.isFunctionExpression(val)) {
      setOut(val);
      continue;
    }

    // Nested namespace object — resolve and recurse
    const inner = resolveToObjectLiteral(val, sf, checker);
    if (inner) {
      out.namespaces.set(path, { docs: docs.trim(), location });
      walkObjectLiteral(inner, path, checker, out, options);
    }
  }
}

export function extractReturnTypesFromSource(
  entryFile: string,
  routesExportName: string,
  soptions: SourceEnrichOptions,
  tsConfigFilePath?: string
): SourceExtractionResult {
  // Use cached program/checker to avoid re-parsing the entire project on repeat calls
  const { program, checker } = getOrCreateProgram(entryFile, tsConfigFilePath);
  const sf = program.getSourceFile(entryFile);

  if (!sf)
    throw new Error(
      `[extractAppRoutesTypes] Cannot open source file: ${entryFile}`
    );

  const routesInit = getExportedVarInitializerViaChecker(
    routesExportName,
    sf,
    checker
  );
  if (!routesInit)
    throw new Error(
      `[extractAppRoutesTypes] Cannot find variable "${routesExportName}" in ${entryFile}`
    );

  const routesObj = resolveToObjectLiteral(routesInit, sf, checker);
  if (!routesObj)
    throw new Error(
      `[extractAppRoutesTypes] Cannot resolve "${routesExportName}" to an object literal in ${entryFile}`
    );

  const out: SourceExtractionResult = {
    leaves: new Map(),
    namespaces: new Map(),
  };
  walkObjectLiteral(routesObj, "", checker, out, soptions);
  return out;
}

// ─── .d.ts emitters ──────────────────────────────────────────────────────────

type TargetFlavor = "client" | "swr" | "react-query" | "vue-query";

/** Emitter for Core Client */
function emitClientMethod(route: FlatRoute): string {
  const inputTs =
    route.kind === "upload"
      ? `${route.inputTs ?? "unknown"} | FormData | Record<string, any>`
      : route.inputTs;

  const inputArg =
    route.inputTs === null ? "input?: null | undefined" : `input: ${inputTs}`;
  const args = `${inputArg}, opts?: RequestOptions`;
  const method = route.kind === "plain" ? "query" : route.kind;

  if (route.kind === "stream") {
    return `${method}(${args}): Promise<AsyncGenerator<${route.outputTs}, void, unknown>>;`;
  }
  return `${method}(${args}): Promise<${route.outputTs}>;`;
}

/** Emitter for SWR */
function emitSwrMethod(route: FlatRoute): string {
  const inputTs =
    route.kind === "upload"
      ? `${route.inputTs ?? "unknown"} | FormData | Record<string, any>`
      : route.inputTs ?? "void";

  const inputArg =
    route.inputTs === null ? "input?: null | undefined" : `input: ${inputTs}`;

  if (route.kind === "plain" || route.kind === "query") {
    return `useQuery(${inputArg}, opts?: SWRConfiguration<${route.outputTs}>): SWRResponse<${route.outputTs}>;`;
  }
  if (route.kind === "mutate" || route.kind === "upload") {
    return `useMutation(opts?: SWRMutationConfiguration<${route.outputTs}, Error, string, ${inputTs}>): SWRMutationResponse<${route.outputTs}, Error, string, ${inputTs}>;`;
  }
  if (route.kind === "stream") {
    return `useStream(${inputArg}, opts?: { enabled?: boolean }): SWRStreamState<${route.outputTs}>;`;
  }
  return "";
}

/** Emitter for React Query */
function emitReactQueryMethod(route: FlatRoute): string {
  const inputTs =
    route.kind === "upload"
      ? `${route.inputTs ?? "unknown"} | FormData | Record<string, any>`
      : route.inputTs ?? "void";

  const inputArg =
    route.inputTs === null ? "input?: null | undefined" : `input: ${inputTs}`;

  if (route.kind === "plain" || route.kind === "query") {
    return `useQuery(${inputArg}, opts?: Omit<UseQueryOptions<${route.outputTs}, Error, ${route.outputTs}>, "queryKey" | "queryFn">): UseQueryResult<${route.outputTs}, Error>;`;
  }
  if (route.kind === "mutate" || route.kind === "upload") {
    return `useMutation(opts?: Omit<UseMutationOptions<${route.outputTs}, Error, ${inputTs}>, "mutationFn">): UseMutationResult<${route.outputTs}, Error, ${inputTs}>;`;
  }
  if (route.kind === "stream") {
    return `useStream(${inputArg}, opts?: { enabled?: boolean }): RQStreamState<${route.outputTs}>;`;
  }
  return "";
}

/** Emitter for TanStack Vue Query */
function emitVueQueryMethod(route: FlatRoute): string {
  const inputTs =
    route.kind === "upload"
      ? `${route.inputTs ?? "unknown"} | FormData | Record<string, any>`
      : route.inputTs ?? "void";

  const inputArg =
    route.inputTs === null ? "input?: null | undefined" : `input: ${inputTs}`;

  if (route.kind === "plain" || route.kind === "query") {
    return `useQuery(${inputArg}, opts?: Omit<UseQueryOptions<${route.outputTs}, Error, ${route.outputTs}>, "queryKey" | "queryFn">): UseQueryReturnType<${route.outputTs}, Error>;`;
  }
  if (route.kind === "mutate" || route.kind === "upload") {
    return `useMutation(opts?: Omit<UseMutationOptions<${route.outputTs}, Error, ${inputTs}>, "mutationFn">): UseMutationReturnType<${route.outputTs}, Error, ${inputTs}, unknown>;`;
  }
  if (route.kind === "stream") {
    return `useStream(${inputArg}, opts?: { enabled?: boolean }): VQStreamState<${route.outputTs}>;`;
  }
  return "";
}

// ─── Tree building — single pass for all four flavors ────────────────────────

interface TreeNode {
  __isNode: true;
  /** Per-flavor method signatures, populated in a single tree build. */
  signatures: Record<TargetFlavor, string>;
  children?: Record<string, TreeNode>;
  docs?: string;
  location?: string;
}

/**
 * Build the route tree once and store all four flavor signatures at each leaf.
 * This replaces four separate buildTree + emitInterfaceBody passes with one,
 * cutting O(routes × 4) traversal to O(routes × 1).
 */
function buildTree(
  routes: FlatRoute[],
  namespacesMeta: Map<string, SourceMeta>
): Record<string, TreeNode> {
  const root: Record<string, TreeNode> = {};

  for (const route of routes) {
    const segments = route.path.split("/");
    let current: Record<string, TreeNode> = root;
    let currentPath = "";

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      currentPath = currentPath ? `${currentPath}/${seg}` : seg;

      if (!current[seg]) {
        const meta = namespacesMeta.get(currentPath);
        current[seg] = {
          __isNode: true,
          signatures: {
            client: "",
            swr: "",
            "react-query": "",
            "vue-query": "",
          },
          children: {},
          docs: meta?.docs,
          location: meta?.location,
        };
      }
      current = current[seg].children as Record<string, TreeNode>;
    }

    const lastSeg = segments[segments.length - 1];
    current[lastSeg] = {
      __isNode: true,
      signatures: {
        client: emitClientMethod(route),
        swr: emitSwrMethod(route),
        "react-query": emitReactQueryMethod(route),
        "vue-query": emitVueQueryMethod(route),
      },
      docs: route.docs,
      location: route.location,
    };
  }

  return root;
}

function emitInterfaceBody(
  tree: Record<string, TreeNode>,
  flavor: TargetFlavor,
  indent: number
): string {
  const pad = " ".repeat(indent);
  const lines: string[] = [];

  for (const [key, node] of Object.entries(tree)) {
    const commentLines: string[] = [];

    if (node.docs) commentLines.push(...node.docs.split("\n"));
    if (node.location)
      commentLines.push(`@see [${node.location}](${node.location})`);

    if (commentLines.length > 0) {
      lines.push(`${pad}/**`);
      commentLines.forEach((c) => lines.push(`${pad} * ${c}`));
      lines.push(`${pad} */`);
    }

    const sig = node.signatures[flavor];

    if (sig) {
      lines.push(`${pad}${key}: {`);

      if (commentLines.length > 0) {
        lines.push(`${pad}  /**`);
        commentLines.forEach((c) => lines.push(`${pad}   * ${c}`));
        lines.push(`${pad}   */`);
      }

      lines.push(`${pad}  ${sig}`);
      lines.push(`${pad}};`);
    } else if (node.children) {
      lines.push(`${pad}${key}: {`);
      lines.push(emitInterfaceBody(node.children, flavor, indent + 2));
      lines.push(`${pad}};`);
    }
  }

  return lines.join("\n");
}

function assembleDts(
  exportName: string,
  body: string,
  flavor: TargetFlavor
): string {
  let header = "";
  let finalExportName = exportName;

  if (flavor === "client") {
    header = `import type { RequestOptions } from "./client";\n`;
  } else if (flavor === "swr") {
    finalExportName = `${exportName}Swr`;
    header =
      `import type { SWRConfiguration, SWRResponse } from "swr";\n` +
      `import type { SWRMutationConfiguration, SWRMutationResponse } from "swr/mutate";\n` +
      `import type { SWRStreamState } from "./swr";\n`;
  } else if (flavor === "react-query") {
    finalExportName = `${exportName}ReactQuery`;
    header =
      `import type { UseQueryOptions, UseQueryResult, UseMutationOptions, UseMutationResult } from "@tanstack/react-query";\n` +
      `import type { RQStreamState } from "./react-query";\n`;
  } else if (flavor === "vue-query") {
    finalExportName = `${exportName}VueQuery`;
    header =
      `import type { UseQueryOptions, UseQueryReturnType, UseMutationOptions, UseMutationReturnType } from "@tanstack/vue-query";\n` +
      `import type { VQStreamState } from "./vue-query";\n`;
  }

  return [
    `// Auto-generated by extractAppRoutesTypes from \`tsdkarc-x/scripts\`. DO NOT EDIT.`,
    `// Re-generate by running your build script after server boot.`,
    ``,
    header,
    `export interface ${finalExportName} {`,
    `  /** @deprecated don't use this, it's only for types inferring */`,
    `  zResolved__: true; // 🚀 MAGIC BULLET: Tells the client to skip deep mapping`,
    body,
    `}`,
    ``,
  ].join("\n");
}

/**
 * Build all three DTS outputs from a single shared tree.
 * @param exportName  Base interface name (e.g. "AppRoutes")
 * @param routes      Flat resolved route list
 * @param namespacesMeta  Namespace doc/location metadata from source extraction
 */
function buildAllDts(
  exportName: string,
  routes: FlatRoute[],
  namespacesMeta: Map<string, SourceMeta>
): {
  output: Pick<
    ExtractTypesResult,
    "clientDts" | "swrDts" | "reactQueryDts" | "vueQueryDts"
  > & { paths: string[] };
} {
  const tree = buildTree(routes, namespacesMeta);

  const output = {
    get clientDts() {
      return assembleDts(
        exportName,
        emitInterfaceBody(tree, "client", 2),
        "client"
      );
    },
    get swrDts() {
      return assembleDts(exportName, emitInterfaceBody(tree, "swr", 2), "swr");
    },
    get reactQueryDts() {
      return assembleDts(
        exportName,
        emitInterfaceBody(tree, "react-query", 2),
        "react-query"
      );
    },
    get vueQueryDts() {
      return assembleDts(
        exportName,
        emitInterfaceBody(tree, "vue-query", 2),
        "vue-query"
      );
    },
    paths: [] as string[],
  };
  return { output };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function extractAppRoutesTypes(
  routes: RuntimeRouteTree,
  options: ExtractTypesOptions = {}
): ExtractTypesResult {
  const exportName = options.exportName ?? "AppRoutes";
  const flatRoutes = collectRoutes(routes);
  const meta = new Map<string, SourceMeta>();
  const output = buildAllDts(exportName, flatRoutes, meta).output;
  output.paths = flatRoutes.map((r) => r.path);
  return output;
}

export function extractAppRoutesTypesFull(
  routes: RuntimeRouteTree,
  sourceOptions: SourceEnrichOptions,
  options: ExtractTypesOptions = {}
): ExtractTypesResult {
  const exportName = options.exportName ?? "AppRoutes";
  const routesExportName = sourceOptions.routesExportName ?? "routes";
  const flatRoutes = collectRoutes(routes);

  const { leaves, namespaces } = extractReturnTypesFromSource(
    sourceOptions.entryFile,
    routesExportName,
    sourceOptions,
    sourceOptions.tsConfigFilePath
  );

  for (const route of flatRoutes) {
    const found = leaves.get(route.path);
    if (found) {
      route.outputTs = found.outputTs ?? "unknown";
      route.docs = found.docs;
      route.location = found.location;

      // If the runtime route has no zod schema (inputTs === null)
      // but the source handler declares a typed first parameter, use that type.
      // This covers: r.query(async (input: MyType, env) => ...) without r.input(z.xxx).
      if (route.inputTs === null && found.inputTs !== undefined) {
        route.inputTs = found.inputTs;
      }
    }
  }

  const output = buildAllDts(exportName, flatRoutes, namespaces).output;
  output.paths = flatRoutes.map((r) => r.path);
  return output;
}
