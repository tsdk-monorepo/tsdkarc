import start, { defineModule } from "tsdkarc";

interface ConfigSlice {
  config: { port: number; dbUrl: string };
}
const configModule = defineModule<ConfigSlice>()({
  name: "config",
  boot: (ctx) => ctx.set("config", { port: 3000, dbUrl: "..." }),
});

interface DbSlice {
  db: Pool;
}
const dbModule = defineModule<DbSlice>()({
  name: "db",
  modules: [configModule], // ctx.config is typed here
  async boot(ctx) {
    const pool = new Pool({ connectionString: ctx.config.dbUrl });
    ctx.set("db", pool);
  },
});

interface ServerSlice {
  server: http.Server;
}
const serverModule = defineModule<ServerSlice>()({
  name: "server",
  modules: [configModule, dbModule], // ctx.config + ctx.db typed
  boot(ctx) {
    ctx.set("server", http.createServer(myHandler));
  },
});

const app = await start([serverModule]);
app.ctx.server.listen(app.ctx.config.port);
