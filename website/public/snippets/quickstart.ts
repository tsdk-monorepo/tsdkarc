import start, {
  defineModule,
  type ContextOf,
  type ContextWriterOf,
  type SetOf
} from "tsdkarc";

// interface ConfigSlice {
//   config: { port: number };
// }
// const configModule = defineModule<ConfigSlice>()({
const configModule = defineModule()({
  name: "config",
  modules: [],
  boot: () => ({
    config: {
      port: 3000,
    },
  }),
});

// Get the module's context type(include the dependencies modules)
export type ConfigModuleCtx = ContextOf<typeof configModule>; // same as `ConfigSlice`

// Get the `set` type of the module
type ConfigModuleSet = ContextWriterOf<typeof configModule>["set"];
// or
type ConfigModuleSet2 = SetOf<typeof configModule>
function test(set: ConfigModuleSet) { // type safe here 
  set("config", { port: 200 });
}

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
