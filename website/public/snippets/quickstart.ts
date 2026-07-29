import { defineModule, type ContextOf } from "tsdkarc";

// 1. Define Config (Returns namespace: ctx.config)
const configModule = defineModule({ name: "config" }).init(() => ({
  port: 3000,
}));

// 2. Define Server (Depends on Config)
const serverModule = defineModule({
  name: "server",
  modules: [configModule],
}).init((ctx) => ({
  listen: () => console.log(`🚀 Server running on port ${ctx.config.port}`),
}));

// Export inferred types for use elsewhere in your app
export type AppCtx = ContextOf<typeof serverModule>;

// 3. Compose and Launch
async function bootstrap() {
  try {
    // Wrap top-level modules in an anonymous root module
    const appModule = defineModule({ modules: [serverModule] }).init(
      () => ({})
    );

    // Display the generated dependency graph
    console.log("\nDependency Tree:\n" + appModule.graph().formatted);
    const app = await appModule.start({
      afterBoot: () => console.log("✅ All modules booted successfully!"),
    });
    // Run the app! (Fully type-safe)
    app.ctx.server.listen();
  } catch (error) {
    // tsdkarc automatically rolls back already-booted modules if a failure occurs here
    console.error("❌ Failed to boot application:", error);
    process.exit(1);
  }
}

bootstrap();
