import { z } from "zod";
import { defineRouter } from "../server";
import { dbModule } from "../../experiment/db.module";

export const helloModule = defineRouter({ modules: [dbModule] })({
  hello(ctx) {
    return ctx.query(z.object({ name: z.string().optional() }), ({ name }) => ({
      msg: "hello",
      name: name ?? "world",
      db: ctx.db,
    }));
  },
  ping(_ctx) {
    return { pong: true };
  },
});
