import express from "express";
import { defineUnit } from "tsdkarc";

export type RouteEntry<Method extends string, Path extends string, Req, Res> = {
  method: Method;
  path: Path;
  _req: Req;
  _res: Res;
};

/**
 * Base arc module — boots an Express app and exposes a typesafe route() helper.
 *
 * @example
 * const myModule = defineUnit({ modules: [arcModule] })({
 *   name: "hello",
 *   boot: (ctx) => ({
 *     hello: ctx.route("GET", "/hello", (req: { name: string }) => ({ msg: `hello ${req.name}` })),
 *   }),
 * });
 */
export const arcModule = defineUnit()({
  name: "base",
  boot() {
    const app = express();
    app.use(express.json());

    function route<Method extends string, Path extends string, Req, Res>(
      method: Method,
      path: Path,
      handler: (req: Req) => Res | Promise<Res>
    ): RouteEntry<Method, Path, Req, Res> {
      const m = method.toLowerCase();
      const isRead = m === "get" || m === "head";

      (app as any)[m](
        path,
        async (req: express.Request, res: express.Response) => {
          try {
            const input = isRead ? (req.query as Req) : (req.body as Req);
            res.json(await handler(input));
          } catch (err) {
            console.error(
              `[route] ${method.toUpperCase()} ${path} error:`,
              err
            );
            res.status(500).json({ error: "Internal server error" });
          }
        }
      );

      return { method: m, path } as RouteEntry<Method, Path, Req, Res>;
    }

    return { app, route };
  },
});
