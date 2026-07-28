import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { ZodError } from "zod";
import type { ServerType } from "@hono/node-server";
import { HttpResponse, RpcError } from "./types";
import type {
  TransportAdapter,
  RuntimeRouteTree,
  CreateContextFn,
  AnyRoute,
} from "./types";
import type { Context } from "hono";

function flattenTree(
  tree: RuntimeRouteTree,
  prefix = ""
): { path: string; route: AnyRoute }[] {
  const routes: { path: string; route: AnyRoute }[] = [];
  for (const [key, node] of Object.entries(tree)) {
    const currentPath = `${prefix}/${key}`;
    if ("_kind" in node)
      routes.push({ path: currentPath, route: node as AnyRoute });
    else routes.push(...flattenTree(node as RuntimeRouteTree, currentPath));
  }
  return routes;
}

export class HonoAdapter implements TransportAdapter<Context> {
  public readonly name = "hono-adapter";
  public readonly app: Hono;
  private server: ServerType | null = null;

  constructor() {
    this.app = new Hono();
  }

  mount(
    basePath: string,
    routeTree: RuntimeRouteTree,
    createContext: CreateContextFn<Context, any>
  ): void {
    const flatRoutes = flattenTree(routeTree, basePath);

    for (const { path, route } of flatRoutes) {
      const method =
        route._kind === "query" || route._kind === "plain" ? "GET" : "POST";

      this.app.on(method, path, async (c) => {
        try {
          const baseCtx = await createContext(c);

          let rawInput: unknown;
          if (route._kind === "query" || route._kind === "plain") {
            const queryRaw = c.req.query();
            const parsedQuery: Record<string, any> = {};
            for (const [k, v] of Object.entries(queryRaw)) {
              try {
                parsedQuery[k] = JSON.parse(v);
              } catch {
                parsedQuery[k] = v;
              }
            }
            rawInput =
              Object.keys(parsedQuery).length > 0 ? parsedQuery : undefined;
          } else if (route._kind === "upload") {
            rawInput = await c.req.parseBody({ all: true });
          } else {
            rawInput = await c.req.json().catch(() => undefined);
          }

          // Safe Serverless execution scope
          let waitUntil: (p: Promise<unknown>) => void;
          try {
            const execCtx = c.executionCtx;
            waitUntil = (p) => execCtx.waitUntil(p);
          } catch (e) {
            waitUntil = (p) => {
              p.catch(console.error);
            };
          }

          const result = await route.handler(rawInput, {
            meta: baseCtx,
            waitUntil,
          } as any);

          if (result instanceof HttpResponse) {
            for (const [k, v] of Object.entries(result.meta.headers || {}))
              c.header(k, v);
            if ([301, 302, 307, 308].includes(result.meta.status || 200)) {
              return c.redirect(
                result.meta.headers?.Location || "/",
                result.meta.status as any
              );
            }
            c.status((result.meta.status as any) || 200);
            return c.json(result.body);
          }

          if (route._kind === "stream") {
            return streamSSE(c, async (stream) => {
              try {
                const generator = result as AsyncGenerator;
                for await (const chunk of generator)
                  await stream.writeSSE({ data: JSON.stringify(chunk) });
                await stream.writeSSE({
                  data: JSON.stringify({ __done: true }),
                });
              } catch (err: any) {
                await stream.writeSSE({
                  data: JSON.stringify({ __error: err.message }),
                });
              }
            });
          }

          return c.json(result);
        } catch (error: any) {
          let rpcError: RpcError;

          if (error instanceof ZodError) {
            rpcError = new RpcError(
              "BAD_REQUEST",
              "Validation failed",
              error.issues.map((i) => ({
                path: i.path as any,
                message: i.message,
              }))
            );
          } else if (error instanceof RpcError) {
            rpcError = error;
          } else {
            console.error(`[HonoAdapter] System Error at ${path}:`, error);
            rpcError = new RpcError(
              "INTERNAL_SERVER_ERROR",
              error.message || "Internal Error"
            );
          }

          const statusMap: Record<string, number> = {
            BAD_REQUEST: 400,
            UNAUTHORIZED: 401,
            FORBIDDEN: 403,
            NOT_FOUND: 404,
            INTERNAL_SERVER_ERROR: 500,
          };

          return c.json(
            {
              error: rpcError.code,
              message: rpcError.message,
              issues: rpcError.issues,
            },
            (statusMap[rpcError.code] as any) || 500
          );
        }
      });
      console.log(`[Hono] Mapped: [${method}] ${path}`);
    }
  }

  start(port: number | string, basePath: string): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve({ fetch: this.app.fetch, port: +port }, (info) => {
        console.log(
          `🚀 Hono Server ready on http://localhost:${info.port}${basePath}`
        );
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
