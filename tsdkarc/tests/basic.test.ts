import { describe, it, expect, vi } from "vitest";
import { deepMerge, defineModule, formatModuleGraph } from "../src/core";
import { ContextOf } from "../src/types";

describe("defineModule Runtime API", () => {
  describe("0. Basic demo", () => {
    it("basic demo", async () => {
      const UserModule = defineModule({
        name: "user",
      }).init(() => {
        const users = [{ id: 1, name: "Alice" }];

        return {
          findUser(id: number) {
            return users.find((user) => user.id === id);
          },
        };
      });

      const LoggerModule = defineModule({
        name: "logger",
      }).init(
        () => ({
          log(message: string) {
            console.log(message);
          },
        }),
        {
          beforeBoot() {
            console.log("beforeBoot [logger]");
          },
        }
      );

      const App = defineModule().with(UserModule, LoggerModule);

      const app = await App.start();

      app.ctx.logger.log("Application started");

      const user = app.ctx.user.findUser(1);

      console.log(user?.name);

      const App2 = defineModule({ modules: [App] });
      const app2 = await App2.start();
      app2.ctx.logger.log("Application started");
      const user2 = app2.ctx.user.findUser(1);
      console.log(user2?.name);

      const hello = defineModule().init(() => {
        return { greet: "hello" };
      });

      const name = defineModule().init(() => {
        return { name: "tsdkarc" };
      });

      const combined1 = defineModule({ modules: [hello, name] }).init();
      combined1.start({
        afterBoot: ({ greet, name }) => {
          console.log(`${greet}, ${name}!`);
        },
      });

      const combined2 = defineModule().with(hello, name);
      const app22 = await combined2.start({
        afterBoot: ({ greet, name }) => {
          console.log(`${greet}, ${name}!`);
        },
      });

      console.log(`${app22.ctx.greet}, ${app22.ctx.name}!`);

      // stop
      app22.stop();

      // Get the ctx type of a module
      type AppCtx = ContextOf<typeof combined2>;

      const namespaceExample = defineModule({ name: "example" }).init(() => {
        return { test: "this is a test for namespace" };
      });
      type NamespaceExampleCtx = ContextOf<typeof namespaceExample>; // {example: {test: string}}
    });

    it("Conflict types", async () => {
      const module1 = defineModule({ name: "example" }).init(() => {
        return { test: "this is a test for namespace" };
      });
      const module2 = defineModule({ name: "example" }).init(() => {
        return { test2: "this is a test for namespace 2" };
      });
      // @ts-expect-error
      defineModule({ modules: [module1, module2] });
      // @ts-expect-error
      defineModule().with(module1, module2);

      defineModule({ ignoreConflicts: ["example"] })
        .with(module1, module2)
        .start({
          afterBoot(ctx) {
            console.log(ctx.example.test, ctx.example.test2);
          },
        });
    });

    it("Classic example", async () => {
      const userService = defineModule().init(() => ({
        getUser() {
          return "user";
        },
      }));

      const userController = defineModule({ modules: [userService] }).init(
        (ctx) => ({
          hello() {
            return ctx.getUser();
          },
        })
      );

      type ControllerCtx = ContextOf<typeof userController>; /* 
      {
       getUser: () => "user";
       hello: () => "user"; 
      }
      */

      const controller = await userController.start();
      console.log(controller.ctx.hello());

      const database = defineModule({ name: "database" }).init(() => {
        return { uri: "real database URI", id1: 1 };
      });
      const fakeDatabase = defineModule({ name: "database" }).init(() => {
        return { uri: "fakedatabse URI", id2: 2 };
      });

      const app = defineModule({ ignoreConflicts: ["database"] }).with(
        database,
        fakeDatabase
      );

      await app.start({
        afterBoot(ctx) {
          console.log(ctx);
        },
      });
    });

    it("graph print", () => {
      const db = defineModule({ name: "db" }).init(() => {
        uri: "db";
      });
      const cache = defineModule({ name: "cache" }).init(() => {
        msg: "cache";
      });
      const app = defineModule({ name: "app", modules: [db, cache] }).init(
        (ctx) => ({})
      );

      console.log(app.graph(), formatModuleGraph(app.graph()));

      expect(formatModuleGraph(app.graph()).trim()).toBe(`- app
  - db
  - cache`);
    });
  });
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Basic Initialization & Context Merging
  // ───────────────────────────────────────────────────────────────────────────

  describe("1. Basic Initialization & Context Merging", () => {
    it("should correctly merge contexts into a flat root context with `ignoreConflicts`", async () => {
      const authRouteModule = defineModule().init(() => ({
        routes: { "/login": () => {} },
      }));

      const userRouteModule = defineModule().init(() => ({
        routes: { "/profile": () => {} },
      }));

      const appModule = defineModule({ ignoreConflicts: ["routes"] }).with(
        authRouteModule,
        userRouteModule
      );
      const appModuleWithError = defineModule({ ignoreConflicts: [] }).with(
        authRouteModule,
        // @ts-expect-error
        userRouteModule
      );
      type typeOfModule = ContextOf<typeof appModule>;

      const m1 = defineModule().init(() => ({ port: 8080 }));
      const m2 = defineModule().init(() => ({ host: "localhost" }));
      const app = defineModule({ modules: [m1, m2] }).init();
      const { ctx } = await app.start();

      expect(ctx.port).toBe(8080);
      expect(ctx.host).toBe("localhost");
    });

    it("should isolate context when using defineModule({ name })", async () => {
      const dbModule = defineModule({ name: "db" }).init(() => ({
        query: () => "data",
      }));
      const app = defineModule({ modules: [dbModule] }).init();
      const { ctx } = await app.start();

      expect(ctx.db).toBeDefined();
      expect(ctx.db.query()).toBe("data");
      // @ts-ignore
      expect(ctx.query).toBeUndefined();
    });

    it("should return an empty ctx when no modules are provided and init returns nothing", async () => {
      const { ctx } = await defineModule().init().start();
      expect(ctx).toEqual({});
    });

    it("should support init returning void (no slice contributed)", async () => {
      const sideEffect = vi.fn();
      const m = defineModule().init(() => {
        sideEffect();
      });
      const { ctx } = await m.start();

      expect(sideEffect).toHaveBeenCalledOnce();
      expect(ctx).toEqual({});
    });

    it("should allow multiple named modules to coexist without key pollution", async () => {
      const modA = defineModule({ name: "a" }).init(() => ({ value: 1 }));
      const modB = defineModule({ name: "b" }).init(() => ({ value: 2 }));
      const { ctx } = await modA.with(modB).start();

      expect(ctx.a.value).toBe(1);
      expect(ctx.b.value).toBe(2);
      // @ts-ignore
      expect(ctx.value).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Composition via .with()
  // ───────────────────────────────────────────────────────────────────────────

  describe("2. Composition via .with()", () => {
    it("should compose sibling modules using .with(...modules)", async () => {
      const logger = defineModule().init(() => ({ log: vi.fn() }));
      const config = defineModule().init(() => ({ env: "test" }));
      const app = defineModule()
        .init(() => ({ appName: "MyApp" }))
        .with(logger, config);
      const { ctx } = await app.start();

      expect(ctx.appName).toBe("MyApp");
      expect(ctx.env).toBe("test");
      expect(typeof ctx.log).toBe("function");
    });

    it("should compose multiple modules via .with() and merge all slices", async () => {
      const utilA = defineModule().init(() => ({ format: true }));
      const utilB = defineModule().init(() => ({ parse: true }));
      const app = defineModule()
        .init(() => ({ core: true }))
        .with(utilA, utilB);
      const { ctx } = await app.start();

      expect(ctx.core).toBe(true);
      expect(ctx.format).toBe(true);
      expect(ctx.parse).toBe(true);
    });

    it("should chain .with() calls and accumulate all keys", async () => {
      const modA = defineModule().init(() => ({ a: 1 }));
      const modB = defineModule().init(() => ({ b: 2 }));
      const modC = defineModule().init(() => ({ c: 3 }));
      const { ctx } = await modA.with(modB).with(modC).start();

      expect(ctx.a).toBe(1);
      expect(ctx.b).toBe(2);
      expect(ctx.c).toBe(3);
    });

    it("should support .with() directly on ModuleDeclaration without calling .init()", async () => {
      const extra = defineModule().init(() => ({ extra: 99 }));
      const { ctx } = await defineModule().with(extra).start();

      expect(ctx.extra).toBe(99);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. ModuleDeclaration shortcuts (.start() / .with() without .init())
  // ───────────────────────────────────────────────────────────────────────────

  describe("3. ModuleDeclaration shortcuts", () => {
    it("should allow .start() directly on declaration without .init()", async () => {
      const dep = defineModule().init(() => ({ ready: true }));
      const { ctx } = await defineModule({ modules: [dep] }).start();

      expect(ctx.ready).toBe(true);
    });

    it("should allow .with() directly on declaration and include all keys", async () => {
      const dep = defineModule().init(() => ({ dep: true }));
      const sibling = defineModule().init(() => ({ sibling: true }));
      const { ctx } = await defineModule({ modules: [dep] })
        .with(sibling)
        .start();

      expect(ctx.dep).toBe(true);
      expect(ctx.sibling).toBe(true);
    });

    it("declaration .start() ctx should only contain dep modules' slices", async () => {
      const m = defineModule().init(() => ({ value: 42 }));
      const { ctx } = await defineModule({ modules: [m] }).start();

      expect(ctx.value).toBe(42);
      // @ts-ignore
      expect(ctx.nonExistent).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Dependency Context Cascading
  // ───────────────────────────────────────────────────────────────────────────

  describe("4. Dependency Context Cascading", () => {
    it("should pass the accumulated context to initFn of subsequent modules", async () => {
      const configMod = defineModule().init(() => ({ port: 3000 }));
      const serverMod = defineModule({ modules: [configMod] }).init((ctx) => ({
        serverUrl: `http://localhost:${ctx.port}`,
      }));
      const { ctx } = await serverMod.start();

      expect(ctx.serverUrl).toBe("http://localhost:3000");
    });

    it("should handle deeply nested module dependencies", async () => {
      const m1 = defineModule({ name: "m1" }).init(() => ({ val: 1 }));
      const m2 = defineModule({ modules: [m1] }).init((ctx) => ({
        val2: ctx.m1.val + 1,
      }));
      const m3 = defineModule({ name: "m3", modules: [m2] }).init((ctx) => ({
        val3: ctx.val2 + 1,
      }));
      const { ctx } = await m3.start();

      expect(ctx.m3.val3).toBe(3);
    });

    it("should not expose transitive deps to downstream consumers", async () => {
      // level1 is an internal dep of level2 — level2's consumer should not see level1's keys
      const level1 = defineModule().init(() => ({ internal: "secret" }));
      const level2 = defineModule({ modules: [level1] }).init(() => ({
        public: "exposed",
      }));
      const { ctx } = await level2.start();

      expect(ctx.public).toBe("exposed");
      expect(ctx.internal).toBe("secret");
    });

    it("should deduplicate shared deps and boot each module exactly once", async () => {
      const initSpy = vi.fn(() => ({ shared: true }));
      const sharedMod = defineModule().init(initSpy);

      const consumerA = defineModule({ modules: [sharedMod] }).init(() => ({
        a: true,
      }));
      const consumerB = defineModule({ modules: [sharedMod] }).init(() => ({
        b: true,
      }));

      await consumerA.with(consumerB).start();

      // sharedMod must only be initialised once despite being declared as a dep of both consumers
      expect(initSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Asynchronous Operations
  // ───────────────────────────────────────────────────────────────────────────

  describe("5. Asynchronous Operations", () => {
    it("should correctly await asynchronous initFn", async () => {
      const asyncMod = defineModule().init(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { isReady: true };
      });
      const { ctx } = await asyncMod.start();

      expect(ctx.isReady).toBe(true);
    });

    it("should resolve async slices before passing ctx to dependent modules", async () => {
      const asyncDep = defineModule().init(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { config: { timeout: 3000 } };
      });

      const consumer = defineModule({ modules: [asyncDep] }).init((ctx) => ({
        resolvedTimeout: ctx.config.timeout,
      }));
      const { ctx } = await consumer.start();

      expect(ctx.resolvedTimeout).toBe(3000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Lifecycle Hooks Ordering
  // ───────────────────────────────────────────────────────────────────────────

  describe("6. Lifecycle Hooks Ordering", () => {
    it("should execute local lifecycle hooks in the correct order", async () => {
      const order: string[] = [];
      const m = defineModule().init(
        () => {
          order.push("init");
          return {};
        },
        {
          beforeBoot: () => {
            order.push("beforeBoot");
          },
          afterBoot: () => {
            order.push("afterBoot");
          },
        }
      );
      await m.start();

      expect(order).toEqual(["beforeBoot", "init", "afterBoot"]);
    });

    it("should interleave global and local hooks correctly", async () => {
      const order: string[] = [];
      const m1 = defineModule().init(
        () => {
          order.push("m1_init");
          return {};
        },
        {
          beforeBoot: () => order.push("m1_local_beforeBoot"),
          afterBoot: () => order.push("m1_local_afterBoot"),
        }
      );
      const app = defineModule({ modules: [m1] }).init(() => {
        order.push("app_init");
        return {};
      });

      await app.start({
        beforeBoot: () => order.push("global_beforeBoot"),
        beforeEachBoot: () => order.push("global_beforeEachBoot"),
        afterEachBoot: () => order.push("global_afterEachBoot"),
        afterBoot: () => order.push("global_afterBoot"),
      });

      expect(order).toEqual([
        "global_beforeBoot",
        "global_beforeEachBoot",
        "m1_local_beforeBoot",
        "m1_init",
        "m1_local_afterBoot",
        "global_afterEachBoot",
        "global_beforeEachBoot",
        "app_init",
        "global_afterEachBoot",
        "global_afterBoot",
      ]);
    });

    it("afterBoot hook should receive the post-boot ctx including own slice", async () => {
      const received: any[] = [];
      defineModule({ name: "svc" }).init(() => ({ running: true }), {
        afterBoot: (ctx) => {
          received.push(ctx);
        },
      });

      // We care about the type, runtime value is checked via a real start()
      const m = defineModule({ name: "svc" }).init(() => ({ running: true }), {
        afterBoot: (ctx) => {
          received.push(ctx);
        },
      });
      await m.start();

      expect(received[0]).toMatchObject({ svc: { running: true } });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Shutdown Sequences
  // ───────────────────────────────────────────────────────────────────────────

  describe("7. Shutdown Sequences", () => {
    it("should execute shutdown hooks when stop() is called", async () => {
      const order: string[] = [];
      const m = defineModule().init(() => ({}), {
        beforeShutdown: (_, reason) => {
          order.push(`beforeShutdown:${reason}`);
        },
        shutdown: () => {
          order.push("shutdown");
        },
        afterShutdown: () => {
          order.push("afterShutdown");
        },
      });
      const { stop } = await m.start();
      await stop("SIGINT");

      expect(order).toEqual([
        "beforeShutdown:SIGINT",
        "shutdown",
        "afterShutdown",
      ]);
    });

    it("should shut down modules in LIFO order", async () => {
      const order: string[] = [];
      const m1 = defineModule().init(() => ({}), {
        shutdown: () => {
          order.push("m1_shutdown");
        },
      });
      const m2 = defineModule().init(() => ({}), {
        shutdown: () => {
          order.push("m2_shutdown");
        },
      });
      const m3 = defineModule().init(() => ({}), {
        shutdown: () => {
          order.push("m3_shutdown");
        },
      });

      const { stop } = await m1.with(m2, m3).start();
      await stop();

      // Must be exactly reversed from boot order
      expect(order).toEqual(["m3_shutdown", "m2_shutdown", "m1_shutdown"]);
    });

    it("should pass the stop reason to all shutdown hooks", async () => {
      const reasons: unknown[] = [];
      const m = defineModule().init(() => ({}), {
        beforeShutdown: (_, r) => {
          reasons.push(r);
        },
        shutdown: (_, r) => {
          reasons.push(r);
        },
        afterShutdown: (_, r) => {
          reasons.push(r);
        },
      });
      const { stop } = await m.start();
      await stop("SIGTERM");

      expect(reasons).toEqual(["SIGTERM", "SIGTERM", "SIGTERM"]);
    });

    it("should execute global shutdown hooks around per-module hooks", async () => {
      const order: string[] = [];
      const m = defineModule().init(() => ({}), {
        shutdown: () => {
          order.push("local_shutdown");
        },
      });

      const { stop } = await m.start({
        beforeShutdown: () => {
          order.push("global_beforeShutdown");
        },
        beforeEachShutdown: () => {
          order.push("global_beforeEachShutdown");
        },
        afterEachShutdown: () => {
          order.push("global_afterEachShutdown");
        },
        afterShutdown: () => {
          order.push("global_afterShutdown");
        },
      });
      await stop();

      expect(order).toEqual([
        "global_beforeShutdown",
        "global_beforeEachShutdown",
        "local_shutdown",
        "global_afterEachShutdown",
        "global_afterShutdown",
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Error Handling & Rollback
  // ───────────────────────────────────────────────────────────────────────────

  describe("8. Error Handling & Rollback", () => {
    it("should abort startup and rollback already-booted modules if a subsequent module fails", async () => {
      const order: string[] = [];
      const m1 = defineModule().init(
        () => {
          order.push("m1_init");
          return { m1: true };
        },
        {
          shutdown: () => {
            order.push("m1_shutdown");
          },
        }
      );
      const m2 = defineModule().init(async () => {
        order.push("m2_init");
        throw new Error("Database connection failed");
      });
      const m3 = defineModule().init(() => {
        order.push("m3_init"); // must never be reached
        return {};
      });

      // @ts-expect-error
      const app = defineModule({ modules: [m1, m2, m3] }).init();
      await expect(app.start()).rejects.toThrow("Database connection failed");

      expect(order).toEqual(["m1_init", "m2_init", "m1_shutdown"]);
    });

    it("should clean up modules in reverse boot order on failure", async () => {
      const sequence: string[] = [];
      const m1 = defineModule().init(() => ({}), {
        afterBoot: () => {
          sequence.push("m1_booted");
        },
        shutdown: () => {
          sequence.push("m1_shutdown");
        },
      });
      const m2 = defineModule().init(async () => {
        throw new Error("m2 exploded");
      });

      const root = defineModule({ modules: [m1, m2] });
      await expect(root.init().start()).rejects.toThrow("m2 exploded");

      expect(sequence).toEqual(["m1_booted", "m1_shutdown"]);
    });

    it("should pass the thrown error as the rollback reason to shutdown hooks", async () => {
      const rollbackReasons: unknown[] = [];
      const boom = new Error("boom");

      const m1 = defineModule().init(() => ({}), {
        shutdown: (_, reason) => {
          rollbackReasons.push(reason);
        },
      });
      const m2 = defineModule().init(() => {
        throw boom;
      });

      const app = defineModule({ modules: [m1, m2] }).init();
      await expect(app.start()).rejects.toThrow("boom");

      // The error itself must be forwarded as the shutdown reason during rollback
      expect(rollbackReasons).toEqual([boom]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. ignoreConflicts — runtime deep merge
  // ───────────────────────────────────────────────────────────────────────────

  describe("9. ignoreConflicts — runtime deep merge", () => {
    it("should deep-merge slices of modules sharing the same name", async () => {
      const routesA = defineModule({ name: "routes" }).init(() => ({
        user: { GET: () => "list users" },
      }));
      const routesB = defineModule({ name: "routes" }).init(() => ({
        post: { GET: () => "list posts" },
      }));

      const { ctx } = await defineModule({
        modules: [routesA, routesB],
        ignoreConflicts: ["routes"],
      }).start();

      // Both contributions must be present
      expect(ctx.routes.user.GET()).toBe("list users");
      expect(ctx.routes.post.GET()).toBe("list posts");
    });

    it("should apply last-write semantics on leaf collisions within an ignored key", async () => {
      const modA = defineModule({ name: "cfg" }).init(() => ({
        timeout: 1000,
        retries: 3,
      }));
      const modB = defineModule({ name: "cfg" }).init(() => ({
        timeout: 5000,
      })); // overrides timeout

      const { ctx } = await defineModule({
        modules: [modA, modB],
        ignoreConflicts: ["cfg"],
      }).start();

      // modB wins on the colliding leaf
      expect(ctx.cfg.timeout).toBe(5000);
      // modA's non-colliding key is preserved
      expect(ctx.cfg.retries).toBe(3);
    });

    it("should deep-merge more than two modules sharing the same ignored name", async () => {
      const a = defineModule({ name: "store" }).init(() => ({ a: 1 }));
      const b = defineModule({ name: "store" }).init(() => ({ b: 2 }));
      const c = defineModule({ name: "store" }).init(() => ({ c: 3 }));

      const { ctx } = await defineModule({
        modules: [a, b, c],
        ignoreConflicts: ["store"],
      }).start();

      expect(ctx.store).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("should not deep-merge keys that are not listed in ignoreConflicts", async () => {
      // Runtime counterpart: two modules both contributing anonymous key 'port'
      // without ignoreConflicts must throw at runtime (slice collision guard)
      const portA = defineModule().init(() => ({ port: 80 }));
      const portB = defineModule().init(() => ({ port: 443 }));

      // @ts-expect-error - type-level collision; also throws at runtime
      const app = defineModule({ modules: [portA, portB] }).init();
      await expect(app.start()).rejects.toThrow(/collision/i);
    });

    it("should recursively deep-merge nested objects under an ignored key", async () => {
      const a = defineModule({ name: "config" }).init(() => ({
        db: { host: "localhost", port: 5432 },
      }));
      const b = defineModule({ name: "config" }).init(() => ({
        db: { port: 5433, ssl: true }, // partial override
      }));

      const { ctx } = await defineModule({
        modules: [a, b],
        ignoreConflicts: ["config"],
      }).start();

      // host from a, ssl from b, port overridden by b
      expect(ctx.config.db).toEqual({
        host: "localhost",
        port: 5433,
        ssl: true,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Edge Cases & Robustness
  // ───────────────────────────────────────────────────────────────────────────

  describe("10. Edge Cases & Robustness", () => {
    it("should correctly pass context through deeply nested modules", async () => {
      const mCore = defineModule({ name: "core" }).init(() => ({
        version: "1.0",
      }));
      const mDb = defineModule({ modules: [mCore] }).init((ctx) => ({
        dbUrl: `url_v${ctx.core.version}`,
      }));
      const mBiz = defineModule({ name: "biz", modules: [mDb] }).init(
        (ctx) => ({
          status: ctx.dbUrl === "url_v1.0" ? "ok" : "fail",
        })
      );
      const { ctx } = await mBiz.start();

      expect(ctx.biz.status).toBe("ok");
    });

    it("should handle a module with no initFn and no hooks without errors", async () => {
      const empty = defineModule().init();
      const { ctx, stop } = await empty.start();

      expect(ctx).toEqual({});
      await expect(stop()).resolves.toBeUndefined();
    });

    it("should allow stop() to be called multiple times without throwing", async () => {
      const { stop } = await defineModule().init().start();

      await expect(stop()).resolves.toBeUndefined();
      await expect(stop()).resolves.toBeUndefined();
    });

    it("should support async shutdown hooks", async () => {
      const log: string[] = [];
      const m = defineModule().init(() => ({}), {
        shutdown: async () => {
          await new Promise((r) => setTimeout(r, 10));
          log.push("async_shutdown_done");
        },
      });
      const { stop } = await m.start();
      await stop();

      expect(log).toEqual(["async_shutdown_done"]);
    });

    it("should detect circular dependency and throw at boot time", async () => {
      // Circular deps can only be constructed by bypassing the type system
      const nodeA: any = { __node: null };
      const nodeB: any = { __node: null };

      // Manually wire a cycle: A → B → A
      nodeA.__node = {
        name: "a",
        deps: [],
        init: () => ({}),
        shutdown: undefined,
        beforeBoot: undefined,
        afterBoot: undefined,
        beforeShutdown: undefined,
        afterShutdown: undefined,
        composite: false,
        members: undefined,
      };
      nodeB.__node = {
        name: "b",
        deps: [nodeA.__node],
        init: () => ({}),
        shutdown: undefined,
        beforeBoot: undefined,
        afterBoot: undefined,
        beforeShutdown: undefined,
        afterShutdown: undefined,
        composite: false,
        members: undefined,
      };
      // Create the cycle
      nodeA.__node.deps = [nodeB.__node];
      // @ts-expect-error
      const app = defineModule({ modules: [nodeA, nodeB] }).init();
      await expect(app.start()).rejects.toThrow(/[Cc]ircular/);
    });
  });

  // deepMerge.security.test.ts

  describe("deepMerge security", () => {
    it("should not pollute Object.prototype via __proto__", () => {
      const malicious = JSON.parse(`
      {
        "__proto__": {
          "polluted": true
        }
      }
    `);

      deepMerge({}, malicious);

      expect(({} as any).polluted).toBeUndefined();
    });

    it("should block nested __proto__ pollution", () => {
      const malicious = {
        database: {
          __proto__: {
            polluted: true,
          },
        },
      };

      deepMerge({}, malicious);

      expect(({} as any).polluted).toBeUndefined();
    });

    it("should block constructor.prototype pollution", () => {
      const malicious = {
        constructor: {
          prototype: {
            polluted: true,
          },
        },
      };

      deepMerge({}, malicious);

      expect(({} as any).polluted).toBeUndefined();
    });

    it("should not mutate source objects", () => {
      const a = {
        database: {
          host: "localhost",
        },
      };

      const b = {
        database: {
          port: 3306,
        },
      };

      deepMerge(a, b);

      expect(a).toEqual({
        database: {
          host: "localhost",
        },
      });

      expect(b).toEqual({
        database: {
          port: 3306,
        },
      });
    });

    it("should create new nested objects", () => {
      const a = {
        config: {
          host: "localhost",
        },
      };

      const b = {
        config: {
          port: 3306,
        },
      };

      const result = deepMerge(a, b);

      expect(result.config).not.toBe(a.config);
      expect(result.config).not.toBe(b.config);
    });

    it("should replace arrays instead of merging", () => {
      const result = deepMerge(
        {
          items: [1, 2],
        },
        {
          items: [3, 4],
        }
      );

      expect(result.items).toEqual([3, 4]);
    });

    it("should replace Date objects instead of recursively merging", () => {
      const date = new Date();

      const result = deepMerge(
        {
          value: date,
        },
        {
          value: {
            foo: "bar",
          },
        }
      );

      expect(result.value).toEqual({
        foo: "bar",
      });
    });

    it("should merge plain objects recursively", () => {
      const result = deepMerge(
        {
          database: {
            host: "localhost",
          },
        },
        {
          database: {
            port: 3306,
          },
        }
      );

      expect(result).toEqual({
        database: {
          host: "localhost",
          port: 3306,
        },
      });
    });

    it("should use last-write-wins semantics", () => {
      const result = deepMerge(
        {
          uri: "real database URI",
        },
        {
          uri: "fake database URI",
        }
      );

      expect(result.uri).toBe("fake database URI");
    });

    it("should support null prototype objects", () => {
      const a = Object.create(null);
      a.id1 = 1;

      const b = Object.create(null);
      b.id2 = 2;

      const result = deepMerge(a, b);

      expect(result).toEqual({
        id1: 1,
        id2: 2,
      });
    });

    it("should handle deeply nested objects", () => {
      const createDeepObject = (depth: number) => {
        let obj: any = {
          value: true,
        };

        for (let i = 0; i < depth; i++) {
          obj = {
            child: obj,
          };
        }

        return obj;
      };

      expect(() => {
        deepMerge({}, createDeepObject(1000));
      }).not.toThrow();
    });

    it("should handle getter properties", () => {
      let called = false;

      const source = {
        get value() {
          called = true;
          return 123;
        },
      };

      deepMerge({}, source);

      expect(called).toBe(true);
    });
  });
});
