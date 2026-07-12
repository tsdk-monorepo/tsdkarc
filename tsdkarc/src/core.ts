import type {
  AnyModule,
  ModuleDeclaration,
  ModuleMeta,
  StartOptions,
  StartResult,
  DepCtxFromList,
  FindDuplicateName,
  ModuleLifecycleHooks,
  NameCollisionError,
  ModuleGraphNode,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Internal runtime representation
// ─────────────────────────────────────────────────────────────────────────────

interface ModuleNode {
  name: string | null;
  deps: ModuleNode[];
  init: (ctx: any) => any;
  shutdown: ((ctx: any, reason?: any) => void | Promise<void>) | undefined;
  beforeBoot: ((ctx: any) => void | Promise<void>) | undefined;
  afterBoot: ((ctx: any) => void | Promise<void>) | undefined;
  beforeShutdown:
    | ((ctx: any, reason?: any) => void | Promise<void>)
    | undefined;
  afterShutdown: ((ctx: any, reason?: any) => void | Promise<void>) | undefined;
  composite: boolean;
  members: ModuleNode[] | undefined;
}

function nodeOf(m: any): ModuleNode {
  return (m as { __node: ModuleNode }).__node;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep merge — runtime implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if `value` is a plain object (not an array, Date, etc.).
 */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

export function isSafeKey(key: string) {
  return key !== "__proto__" && key !== "prototype";
}

/**
 * Recursively merges `b` into `a`.
 * - Both plain objects → recurse.
 * - Otherwise → b wins (last-write semantics).
 * Always returns a new object; inputs are never mutated.
 */
export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  const result = {
    ...a,
  };

  for (const key of Object.keys(b)) {
    if (!isSafeKey(key)) {
      continue;
    }

    const aVal = result[key];
    const bVal = b[key];

    result[key] =
      isPlainObject(aVal) && isPlainObject(bVal) ? deepMerge(aVal, bVal) : bVal;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Topological sort
// ─────────────────────────────────────────────────────────────────────────────

function topoSort(roots: ModuleNode[]): ModuleNode[] {
  const sorted: ModuleNode[] = [];
  const visited = new Set<ModuleNode>();
  const visiting = new Set<ModuleNode>();

  function visit(node: ModuleNode) {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      throw new Error(
        `[tsdkarc] Circular dependency detected at module "${
          node.name ?? "<anon>"
        }"`
      );
    }
    visiting.add(node);
    for (const dep of node.deps) visit(dep);
    visiting.delete(node);
    visited.add(node);
    sorted.push(node);
  }

  for (const root of roots) visit(root);
  return sorted;
}

function flattenMembers(node: ModuleNode): ModuleNode[] {
  if (node.composite && node.members) {
    return node.members.flatMap(flattenMembers);
  }
  return [node];
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency graph inspection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a serializable dependency graph from a runtime ModuleNode.
 * Named modules use their name; unnamed modules use "anonymous".
 * `seen` dedupes shared dependencies (diamond graphs) so each node is
 * only visited once and cycles cannot cause infinite recursion.
 */
function buildGraphNode(
  node: ModuleNode,
  seen: Map<ModuleNode, ModuleGraphNode>
): ModuleGraphNode {
  const existing = seen.get(node);
  if (existing) return existing;

  const graphNode: ModuleGraphNode = {
    name: node.name ?? "anonymous",
    deps: [],
  };
  seen.set(node, graphNode);

  for (const dep of node.deps) {
    graphNode.deps.push(buildGraphNode(dep, seen));
  }

  return graphNode;
}

/**
 * Renders a ModuleGraphNode tree as an indented, printable string.
 * @param graph  ModuleGraphNode
 * @param depth  current indentation depth (internal, defaults to 0)
 */
export function formatModuleGraph(graph: ModuleGraphNode, depth = 0) {
  const indent = "  ".repeat(depth);
  const lines = [`${indent}- ${graph.name}`];

  for (const dep of graph.deps) {
    lines.push(formatModuleGraph(dep, depth + 1));
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot execution
// ─────────────────────────────────────────────────────────────────────────────

async function bootNodes(
  nodes: ModuleNode[],
  options: StartOptions<any, any>,
  ignoreConflicts: ReadonlySet<string>
): Promise<{ ctx: any; bootOrder: ModuleNode[] }> {
  let ctx: any = {};
  const bootOrder: ModuleNode[] = [];

  try {
    await options.beforeBoot?.(ctx);

    for (const node of nodes) {
      const meta: ModuleMeta = {
        name: node.name,
        kind: node.name ? "named" : "anon",
      };

      await options.beforeEachBoot?.(ctx, meta);
      await node.beforeBoot?.(ctx);

      const slice = await node?.init?.(ctx);

      if (slice) {
        if (node.name) {
          if (ignoreConflicts.has(node.name) && node.name in ctx) {
            // Deep-merge into the existing ctx key rather than overwriting.
            const existing = ctx[node.name];
            ctx = {
              ...ctx,
              [node.name]:
                isPlainObject(existing) && isPlainObject(slice)
                  ? deepMerge(existing, slice)
                  : slice,
            };
          } else {
            ctx = { ...ctx, [node.name]: slice };
          }
        } else {
          const collidingKeys = Object.keys(slice).filter((k) => k in ctx);
          const nonIgnoredCollisions = collidingKeys.filter(
            (k) => !ignoreConflicts.has(k)
          );

          if (nonIgnoredCollisions.length > 0) {
            throw new Error(
              `[tsdkarc] Anonymous module slice collision: keys [${nonIgnoredCollisions.join(
                ", "
              )}] already exist in ctx.`
            );
          }

          // For anonymous modules, deep-merge ignored keys and spread the rest.
          let merged: Record<string, unknown> = { ...ctx };
          for (const [key, value] of Object.entries(slice)) {
            if (ignoreConflicts.has(key) && key in merged) {
              const existing = merged[key];
              merged[key] =
                isPlainObject(existing) && isPlainObject(value as any)
                  ? deepMerge(existing, value as Record<string, unknown>)
                  : value;
            } else {
              merged[key] = value as unknown;
            }
          }
          ctx = merged;
        }
      }

      await node.afterBoot?.(ctx);
      await options.afterEachBoot?.(ctx, meta);

      bootOrder.push(node);
    }

    await options.afterBoot?.(ctx);

    return { ctx, bootOrder };
  } catch (error) {
    // Rollback: shut down all fully initialised modules in reverse order.
    // The caught error is passed as `reason` so modules know why they are aborting.
    await shutdownNodes(bootOrder, ctx, options, error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shutdown execution
// ─────────────────────────────────────────────────────────────────────────────

async function shutdownNodes(
  bootOrder: ModuleNode[],
  ctx: any,
  options: StartOptions<any, any>,
  reason?: any
) {
  await options.beforeShutdown?.(ctx, reason);

  for (const node of [...bootOrder].reverse()) {
    const meta: ModuleMeta = {
      name: node.name,
      kind: node.name ? "named" : "anon",
    };

    await options.beforeEachShutdown?.(ctx, meta, reason);
    await node.beforeShutdown?.(ctx, reason);
    await node.shutdown?.(ctx, reason);
    await node.afterShutdown?.(ctx, reason);
    await options.afterEachShutdown?.(ctx, meta, reason);
  }

  await options.afterShutdown?.(ctx, reason);
}

// ─────────────────────────────────────────────────────────────────────────────
// Module handle factory
// ─────────────────────────────────────────────────────────────────────────────

function makeModuleHandle(
  node: ModuleNode,
  ignoreConflicts: ReadonlySet<string>
): AnyModule {
  const handle = {
    __node: node,
    _kind: node.name ? ("named" as const) : ("anon" as const),
    _name: node.name,
    _depCtx: undefined,
    _ownSlice: undefined,

    /** Returns this module's dependency graph, rooted at itself. */
    graph() {
      return buildGraphNode(node, new Map());
    },

    with(...args: any[]) {
      let moduleArgs: any[];
      let overrideName: string | undefined;

      if (Array.isArray(args[0])) {
        moduleArgs = args[0];
        overrideName = args[1]?.name;
      } else {
        const lastArg = args.at(-1);
        const hasOptions =
          lastArg !== null &&
          typeof lastArg === "object" &&
          !("__node" in lastArg);

        moduleArgs = hasOptions ? args.slice(0, -1) : args;
        overrideName = hasOptions ? lastArg?.name : undefined;
      }

      const allModules = [handle, ...moduleArgs];
      const allNodes = allModules.map(nodeOf);
      const members = allNodes.flatMap(flattenMembers);
      const sorted = topoSort(members);

      const compositeNode: ModuleNode = {
        name: overrideName ?? null,
        deps: allNodes,
        init: () => ({}),
        shutdown: undefined,
        beforeBoot: undefined,
        afterBoot: undefined,
        beforeShutdown: undefined,
        afterShutdown: undefined,
        composite: true,
        members: sorted,
      };

      return makeModuleHandle(compositeNode, ignoreConflicts);
    },

    async start(options: StartOptions<any, any> = {}) {
      const members = flattenMembers(node);
      const sorted = topoSort(members);
      const { ctx, bootOrder } = await bootNodes(
        sorted,
        options,
        ignoreConflicts
      );
      const stop = async (reason?: any) => {
        await shutdownNodes(bootOrder, ctx, options, reason);
      };
      return { ctx, stop } satisfies StartResult<any, any>;
    },
  };

  return handle as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// defineModule — public API entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Defines a module with optional name, dependencies, and conflict-ignore list.
 *
 * @example — basic named module
 * ```ts
 * const db = defineModule({ name: "db" }).init(() => createDb())
 * ```
 *
 * @example — skip .init() entirely
 * ```ts
 * const { ctx } = await defineModule({ modules: [db] }).start()
 * ```
 *
 * @example — allow multiple modules to contribute to the same ctx key
 * ```ts
 * const app = defineModule({
 *   modules: [routesA, routesB],
 *   ignoreConflicts: ["routes"],
 * }).init(...) // ctx.routes is a deep-merged union of both modules' `routes` objects
 * ```
 */
export function defineModule<
  Name extends string | null = null,
  const Deps extends AnyModule[] = [],
  const Ignored extends string = never
>(meta?: {
  name?: Name extends keyof DepCtxFromList<Deps, Ignored>
    ? NameCollisionError<Name & string>
    : Name;
  modules?: [...Deps] &
    (FindDuplicateName<Deps, Ignored> extends string
      ? FindDuplicateName<Deps, Ignored>
      : unknown);
  /** Ctx top-level keys whose duplicate-name check is suppressed; colliding
   *  slices are deep-merged at runtime instead of causing a type error. */
  ignoreConflicts?: Ignored[];
}): ModuleDeclaration<Name, DepCtxFromList<Deps, Ignored>, Ignored>;

export function defineModule<
  Name extends string | null = null,
  const Deps extends AnyModule[] = [],
  const Ignored extends string = never
>(meta?: {
  name?: Name;
  modules?: [...Deps];
  ignoreConflicts?: Ignored[];
}): ModuleDeclaration<Name, DepCtxFromList<Deps, Ignored>, Ignored> {
  const name = (meta?.name ?? null) as Name;
  const deps = (meta?.modules ?? []).map(nodeOf);
  const ignoredSet: ReadonlySet<string> = new Set(meta?.ignoreConflicts ?? []);

  // Shared init builder — used by both .init() and the .start()/.with() shortcuts.
  function buildNode(
    initFn?: (ctx: any) => any,
    hooks?: ModuleLifecycleHooks<any, any, any>
  ): ModuleNode {
    const safeInit = initFn ?? (() => ({}));
    const safeHooks = hooks ?? {};
    return {
      name: name as string | null,
      deps,
      init: (ctx) => safeInit(ctx),
      shutdown: safeHooks.shutdown,
      beforeBoot: safeHooks.beforeBoot,
      afterBoot: safeHooks.afterBoot,
      beforeShutdown: safeHooks.beforeShutdown,
      afterShutdown: safeHooks.afterShutdown,
      composite: false,
      members: undefined,
    };
  }

  const declaration: ModuleDeclaration<
    Name,
    DepCtxFromList<Deps, Ignored>,
    Ignored
  > = {
    init(initFn?: any, hooks?: any) {
      const node = buildNode(initFn, hooks);
      return makeModuleHandle(node, ignoredSet) as any;
    },

    /** Shortcut: `.init().start(options)` — no own slice. */
    start(options: any = {}) {
      return declaration.init().start(options) as any;
    },

    /** Shortcut: `.init().with(...modules)` — no own slice. */
    with(...args: any[]) {
      return (declaration.init() as any).with(...args);
    },
  };

  return declaration;
}
