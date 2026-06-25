// ─── Hello ────────────────────────────────────────────────────────────────────

import start, { ContextOf, defineModule } from "tsdkarc";
import { arcModule } from "./server";

type HelloReq = { name?: string };
type HelloRes = { msg: string; data: HelloReq };

const helloModule = defineModule()({
  name: "hello",
  modules: [arcModule] as const,
  boot(ctx) {
    return {
      routes: [
        ctx.route<"get", "/hello", HelloReq, HelloRes>(
          "get",
          "/hello",
          (data) => ({ msg: "hello", data })
        ),
      ] as const,
    };
  },
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

type CrudReq = Record<string, never>;
type CrudRes = { msg: string; store: number; data: CrudReq };

const crudModule = defineModule()({
  name: "crud",
  modules: [arcModule] as const,
  boot(ctx) {
    let store = 0;
    return {
      routes: [
        ctx.route<"get", "/crud", CrudReq, CrudRes>("get", "/crud", (data) => ({
          msg: "crud",
          store,
          data,
        })),
        ctx.route<"post", "/crud", CrudReq, CrudRes>(
          "post",
          "/crud",
          (data) => {
            store++;
            return { msg: "crud", store, data };
          }
        ),
        ctx.route<"delete", "/crud", CrudReq, CrudRes>(
          "delete",
          "/crud",
          (data) => {
            store--;
            return { msg: "crud", store, data };
          }
        ),
      ] as const,
    };
  },
});

// ─── Export & Boot ────────────────────────────────────────────────────────────

export type AppModules = [
  ContextOf<typeof helloModule>,
  ContextOf<typeof crudModule>
];

const PORT = 5001;

start([helloModule, crudModule], {
  afterBoot(ctx) {
    ctx.app.listen(PORT, () => {
      console.log(`[server] listening on http://localhost:${PORT}`);
    });
  },
  onError(err, _ctx, mod) {
    console.error(`[${mod.name}] boot error:`, err.message);
    throw err;
  },
});
