import { defineModule } from "tsdkarc";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { configModule } from "./config.module";
import { loggerModule } from "./logger.module";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export const dbModule = defineModule()({
  name: "db",
  modules: [configModule, loggerModule] as const,
  boot(ctx) {
    const client = postgres(ctx.config.dbUrl);
    const db = drizzle(client, { schema });
    ctx.logger.info("[db] connected");
    return { db };
  },
  async shutdown(ctx) {
    await ctx.db.$client.end();
    ctx.logger.info("[db] closed");
  },
});
