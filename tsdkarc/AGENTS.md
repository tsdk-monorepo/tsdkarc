<system_context>
<library_definition name="tsdkarc">
<description>Dependency Injection (DI) and module composition library for TypeScript. Zero decorators, zero `reflect-metadata`. Context (`ctx`) is strictly inferred at compile-time via `init()` return values.</description>

<core_mechanics> - No Decorators: DO NOT use `@Injectable()` or similar. - Context Inference: `ctx` is automatically merged from dependencies via exact structural typing. Use `ContextOf<typeof Module>` to extract types. - Module Definition: `defineModule({ name?: string, modules?: AnyModule[] })` - Initialization: `.init((ctx) => ReturnType)`
</core_mechanics>

<usage_examples>
// 1. Define a base module
const dbModule = defineModule({ name: 'db' }).init(() => ({ query: () => 'data' }));

    // 2. Extract type for pure classes
    type IDb = ContextOf<typeof dbModule>["db"];

    // 3. Define a dependent module
    const myModule = defineModule({
      name: 'myModule',
      modules: [dbModule]
    }).init((ctx) => {
      // ctx.db is automatically inferred
      return new MyService(ctx.db);
    });

</usage_examples>
</library_definition>

<library_definition name="tsdkarc-x">
<description>Type-safe RPC framework built on `tsdkarc`. Unifies server routing, zod validation, type-safe clients, and frontend hooks integration with standard useQuery / useMutation APIs.</description>
<core_mechanics> - Router Definition: `defineRouter({ modules?: AnyModule[], middlewares?: Middleware[] }).init((r, ctx) => routesObject)` - Launch: `launchApp({ transport, createContext, routes })` - Frontend Hooks: - SWR Wrapper: `createSwrClient<AppRoutes>(client)` -> provides `.useQuery()` / `.useMutation()` - React Query Wrapper: `createQueryClient<AppRoutes>(client)` -> provides `.useQuery()` / `.useMutation()`
</core_mechanics>

<usage_examples>
// 1. Router Definition (Server)
const myRouter = defineRouter({ modules: [myModule] }).init((r) => ({
getProfile: r.query(z.object({ id: z.string() }), async (input, env) => {
return { id: input.id, name: "Alice" };
}),
updateProfile: r.mutate(z.object({ name: z.string() }), async (input, env) => {
return { success: true };
})
}));

    // 2. Server Launch (Server)
    const app = launchApp({
      basePath: "/api",
      transport: new ExpressAdapter(),
      createContext: async (req) => ({ token: req.header('auth') }),
      routes: { my: myRouter },
      port: 3000
    });

    // 3. Base Client & Type Extraction (Client)
    type AppRoutes = RoutesOf<typeof app>; // Extract EXACTLY from launchApp output
    const client = createClient<AppRoutes>({ baseURL: 'http://localhost:3000/api' });

    // 4. Frontend Hooks Integration (Client)
    import { createSwrClient, createQueryClient } from 'tsdkarc-x';

    // Both wrappers support .useQuery() and .useMutation() natively
    const hooks = createQueryClient<AppRoutes>(client);

    // Usage in React Component with full type safety:
    // const { data } = hooks.my.getProfile.useQuery({ id: "123" });
    // const { trigger, isMutating } = hooks.my.updateProfile.useMutation();

    // 5. Use `defineMiddleware`

    type BaseCtx = Awaited<ReturnType<typeof createContext>>;

    // Basic auth
    const authMw = defineMiddleware<BaseCtx>()(async (ctx, next) => {
      if (!ctx.token) throw new RpcError("UNAUTHORIZED", "Missing Bearer Token");
      return next({ user: { id: "u_1", role: "admin" } });
    });

    // Requires authMw to have already injected `user`
    const requireAdminMw = defineMiddleware<{ user: { role: string } }>()(
      async (ctx, next) => {
        if (ctx.user.role !== "admin")
          throw new RpcError("FORBIDDEN", "Admin only.");
        return next({ isAdmin: true });
      }
    );

</usage_examples>
</library_definition>

<generation_directives>
When generating or refactoring code using these libraries, STRICTLY adhere to the following enterprise architectural principles (The "Pragmatic Backend shadcn" Model):

1.  NO DECORATORS: Completely avoid DI decorators.
2.  PURE SERVICE CLASSES: Implement domain logic inside pure TypeScript `class`es. Inject dependencies purely via the constructor.
3.  PRAGMATIC DEPENDENCY TYPING (No Over-Abstraction):
    - For standard CRUD/Business modules: Directly inject the concrete ORM instance (e.g., Drizzle DB) using `import type { ContextOf }` from the infra module. DO NOT create redundant interfaces. Embrace the "shadcn" source-copying model.
4.  DECENTRALIZED CONFIG (Config as Props): NEVER use `process.env` inside reusable components or domain logic.
    - Components MUST define their own `ConfigSchema` using Zod.
    - The Component's factory function (`createXxxComponent(options)`) accepts this `config` as an explicit property and validates it via Zod (Fail-Fast).
5.  GLUE MODULES: Use `tsdkarc`'s `defineModule` exclusively as a factory layer (`xxx.module.ts`). The `.init(ctx)` function extracts dependencies from `ctx`, calls `new Service(config, ctx.db)`, and returns the instance.
6.  THIN ROUTERS: Route handlers (`tsdkarc-x`) must NEVER contain business logic or DB calls. They only receive requests, call the Service class method, and return the response.
7.  EXTRACT SCHEMAS: Define `zod` schemas as standalone constants in a separate file (`xxx.schema.ts`).
8.  FILE STRUCTURE:
    ```text
    src/
     ├── core/                      # Host-level Infrastructure (e.g., db.module.ts exposing Drizzle)
     ├── domains/                   # Feature modules (Pragmatic shadcn-like components)
     │    └── user/
     │         ├── user.config.ts   # Zod Config Schema for this component
     │         ├── user.schema.ts   # RPC Request/Response Zod schemas
     │         ├── user.service.ts  # Pure class relying directly on ContextOf<typeof dbModule>
     │         ├── user.module.ts   # Component Factory accepting { config, dbModule }
     │         └── user.router.ts   # RPC routes (tsdkarc-x)
     ├── app.ts                     # Reads env, injects Config & DB adapter, starts server
     └── client.ts                  # Client types (MUST use RoutesOf<typeof app>)
    ```
9.  TYPE EXTRACTION: Always use `RoutesOf<typeof app>` for client instantiation. NEVER extract from `defineRouter`.
10. FRONTEND HOOKS COMPATIBILITY: When generating client-side React components, always encourage and utilize `createSwrClient` or `createQueryClient` wrappers to obtain standard `.useQuery()` and `.useMutation()` hooks matching the exact server route tree.
11. STREAM & UPLOAD RULES: Always use `async function*` for `r.stream`. Always use `z.coerce` for numbers/booleans in `r.upload`/`r.query` schemas.
    </generation_directives>
    </system_context>
