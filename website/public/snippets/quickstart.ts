import start, { defineModule } from "tsdkarc";

interface ConfigSlice {
  config: { port: number };
}
const configModule = defineModule<ConfigSlice>()({
  name: "config",
  modules: [],
  boot: (ctx) => ctx.set("config", { port: 3000 }),
});

interface ServerSlice {
  server: { listen: () => void };
}
const serverModule = defineModule<ServerSlice>()({
  name: "server",
  modules: [configModule], // 👈 Declares dependency
  boot(ctx) {
    ctx.set("server", {
      listen: () => {
        console.log(`Running on ${ctx.config.port}`); // 👈 Fully typed
      },
    });
  },
});

// Launch 🚀
const app = await start([serverModule]);
app.ctx.server.listen(); // Running on 3000
