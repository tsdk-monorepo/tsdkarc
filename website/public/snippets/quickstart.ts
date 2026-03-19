import start, { defineModule, type InferContextBy } from "tsdkarc";

interface ConfigSlice {
  config: { port: number };
}
const configModule = defineModule<ConfigSlice>()({
  name: "config",
  modules: [],
  boot: () => ({
    config: {
      port: 3000,
    },
  }),
});

// Get context type directly from the module
export type ConfigModuleCtx = InferContextBy<typeof configModule>; // same as `ConfigSlice`

interface ServerSlice {
  server: { listen: () => void };
}
const serverModule = defineModule<ServerSlice>()({
  name: "server",
  modules: [configModule], // 👈 Declares dependency
  boot(ctx) {
    return {
      server: {
        listen: () => {
          console.log(`Running on ${ctx.config.port}`); // 👈 Fully typed
        },
      },
    };
    // Or:
    /*
      ctx.set("server", {
        listen: () => {
          console.log(`Running on ${ctx.config.port}`); // 👈 Fully typed
        },
      });
    */
  },
});

// Launch 🚀
const app = await start([serverModule], {
  afterBoot() {
    console.log("The app is running");
  },
  onError(error, ctx, mod) {
    console.log(`${mod.name} error`, error.message);
    // throw error;
  },
});
app.ctx.server.listen(); // Running on 3000
