// express-adapter.ts
import express, { Request, Response } from "express";
import multer from "multer";
import { Server } from "http";
import { ZodError } from "zod";
import { HttpResponse, RpcError } from "./types";
import type {
  TransportAdapter,
  RuntimeRouteTree,
  CreateContextFn,
  AnyRoute,
} from "./types";

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

export class ExpressAdapter implements TransportAdapter<Request> {
  public readonly name = "express-adapter";
  public readonly app: express.Express;
  private server: Server | null = null;
  private upload = multer({ storage: multer.memoryStorage() });
  private log = false;

  constructor(props?: { log?: boolean }) {
    this.log = props?.log || false;
    this.app = express();
    this.app.use(express.json());
  }

  mount(
    basePath: string,
    routeTree: RuntimeRouteTree,
    createContext: CreateContextFn<Request, any>
  ): void {
    const flatRoutes = flattenTree(routeTree, basePath);

    for (const { path, route } of flatRoutes) {
      const method =
        route._kind === "query" || route._kind === "plain"
          ? ("get" as const)
          : ("post" as const);

      const middlewares = route._kind === "upload" ? [this.upload.any()] : [];
      (this.app as any)[method](
        path,
        ...middlewares,
        async (req: Request, res: Response) => {
          try {
            const baseCtx = await createContext(req);
            let rawInput: unknown;

            if (route._kind === "query" || route._kind === "plain") {
              const parsedQuery: Record<string, any> = {};
              for (const [k, v] of Object.entries(req.query)) {
                if (typeof v === "string") {
                  try {
                    parsedQuery[k] = JSON.parse(v);
                  } catch {
                    parsedQuery[k] = v;
                  }
                } else {
                  parsedQuery[k] = v;
                }
              }
              rawInput =
                Object.keys(parsedQuery).length > 0 ? parsedQuery : undefined;
            } else if (route._kind === "upload") {
              const body = { ...req.body };
              if (Array.isArray(req.files)) {
                req.files.forEach((f) => {
                  body[f.fieldname] = new File(
                    [new Uint8Array(f.buffer)],
                    f.originalname,
                    {
                      type: f.mimetype,
                    }
                  );
                });
              }
              rawInput = body;
            } else {
              rawInput =
                Object.keys(req.body).length > 0 ? req.body : undefined;
            }

            const waitUntil = (p: Promise<unknown>) => {
              p.catch(console.error);
            };

            const result = await route.handler(rawInput, {
              meta: baseCtx,
              waitUntil,
            } as any);

            if (result instanceof HttpResponse) {
              for (const [k, v] of Object.entries(result.meta.headers || {}))
                res.setHeader(k, v);
              if ([301, 302, 307, 308].includes(result.meta.status || 200)) {
                return res.redirect(
                  result.meta.status || 302,
                  result.meta.headers?.Location || "/"
                );
              }
              return res.status(result.meta.status || 200).json(result.body);
            }

            if (route._kind === "stream") {
              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              });
              res.flushHeaders();

              try {
                const generator = result as AsyncGenerator;
                for await (const chunk of generator) {
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
                res.write(`data: ${JSON.stringify({ __done: true })}\n\n`);
              } catch (err: any) {
                res.write(
                  `data: ${JSON.stringify({ __error: err.message })}\n\n`
                );
              }
              return res.end();
            }

            return res.json(result);
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
              console.error(`[ExpressAdapter] System Error at ${path}:`, error);
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
            return res.status(statusMap[rpcError.code] || 500).json({
              error: rpcError.code,
              message: rpcError.message,
              issues: rpcError.issues,
            });
          }
        }
      );
      if (this.log)
        console.log(`[Express] Mapped: [${method.toUpperCase()}] ${path}`);
    }
  }

  start(port: number | string, basePath: string): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(
          `🚀 Express Server ready on http://localhost:${port}${basePath}`
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
