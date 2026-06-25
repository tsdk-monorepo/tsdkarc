import type { ReqMeta, Transport } from "../transport/interface";
import { type AnyModule, type FullContext } from "tsdkarc";
import { createArc } from "./create-arc";
import {
  _defineRoutes,
  _createApp,
  type Middleware,
  type RoutesMap,
  type ArcCtx,
} from "./server";

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates and starts a server.
 *
 * makeTransport is the only framework-specific argument.
 * Everything else (routes, middleware, openapi) is framework-agnostic.
 *
 * @param opts           Server configuration
 *
 * @example — Hono
 * createServer({ transport: () => honoTransport, port: 3000, routes: [helloModule] });
 *
 * @example — Fastify
 * createServer({ transport: () = fastifyTransport, port: 3000, routes: [helloModule] });
 */
export function createServer<
  const M extends readonly AnyModule[] = [],
  TApp = unknown,
  Raw = unknown
>(opts: {
  /** Base path for all routes. Default is `/` */
  prefix?: string;
  transport: () => Transport<TApp, Raw>;
  port?: number;
  hostname?: string;
  middleware?: Middleware[];
  /** Shared modules injected into every route's context. */
  modules?: M;
  /**
   * Called after all routes are registered and the server is about to listen.
   * Use for framework-native extras (health endpoints, swagger UI, etc.).
   * TApp is fully typed — no cast needed.
   */
  onReady?: (app: TApp, transport: Transport<TApp>) => void;
  onError?: (err: Error, mod: { name: string }) => void;
}) {
  const transport = opts.transport();

  const arc = createArc(transport, {
    prefix: opts.prefix,
    middleware: opts.middleware ?? [],
    modules: opts.modules ?? [],
  });

  function defineRoutes<const M extends readonly AnyModule[] = []>(opts?: {
    name?: string;
    middleware?: Middleware[];
    modules?: M;
  }) {
    type Ctx = FullContext<[typeof arc, ...M], ArcCtx>;

    return function <R extends RoutesMap<Ctx>>(routes: R) {
      return _defineRoutes(arc, {
        name: opts?.name,
        middleware: opts?.middleware,
        modules: opts?.modules ?? ([] as unknown as M),
      })(routes);
    };
  }
  const createApp: typeof _createApp = async (...args) => {
    const result = await _createApp(...args);
    // Let the user register framework-native routes before listen
    opts.onReady?.(transport.app, transport);

    transport.mount({
      port: opts.port ?? 3000,
      hostname: opts.hostname ?? "localhost",
      onListen: ({ port, hostname }) =>
        console.log(`[server] listening on http://${hostname}:${port}`),
    });
    return result;
  };

  return {
    arc,
    defineRoutes,
    transport,
    app: transport.app,
    start: transport.mount,
    createApp,
  };
}

export type DefineRoutesFn = Awaited<
  ReturnType<typeof createServer>
>["defineRoutes"];
