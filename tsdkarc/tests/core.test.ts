/**
 * Consolidated test suite for the defineModule module system.
 *
 * Sections:
 *   0.  Type-level checks (compile-time, via @ts-expect-error)
 *   1.  Basic usage walkthrough
 *   2.  Context merging & initialization
 *   3.  Composition via .with()
 *   4.  ModuleDeclaration shortcuts (.start() / .with() without .init())
 *   5.  Dependency context cascading
 *   6.  Named vs anonymous module context shape
 *   7.  Asynchronous operations
 *   8.  Lifecycle hook ordering
 *   9.  Shutdown sequences
 *   10. Error handling & rollback
 *   11. ignoreConflicts — runtime deep merge
 *   12. Circular dependency guard
 *   13. Edge cases & robustness
 *   14. deepMerge security & correctness
 *
 * Fixtures are declared local to the describe block that uses them unless
 * shared across multiple sections, in which case they are declared at
 * module scope directly above the sections that use them.
 */
import { describe, it, expect, vi } from "vitest";
import { deepMerge, defineModule, formatModuleGraph } from "../src/core";
import { ContextOf } from "../src/types";

// ─────────────────────────────────────────────────────────────────────────────
// 0. Type-level checks (compile-time only — no runtime assertions)
// ─────────────────────────────────────────────────────────────────────────────
// Each `it` body is never meaningfully exercised at runtime; its purpose is to
// give tsc a scope in which `@ts-expect-error` can be checked during `tsc
// --noEmit`. Keep one scenario per `it` so a broken type contract points at
// a single, named failure.

describe("0. Type-level checks", () => {
  it("empty module ctx exposes no keys", () => {
    defineModule().init((ctx) => {
      // @ts-expect-error: empty ctx has no keys
      ctx.something_not_exist;
    });
  });

  it("dep ctx keys are typed and unknown keys are rejected", () => {
    const dbMod = defineModule().init(() => ({ dbPort: 5432 }));
    const cacheMod = defineModule().init(() => ({ cachePort: 6379 }));

    defineModule({ modules: [dbMod, cacheMod] }).init((ctx) => {
      const p1: number = ctx.dbPort;
      const p2: number = ctx.cachePort;

      // @ts-expect-error: non-existent key
      const p3 = ctx.nonExist;

      return { status: "ok" };
    });
  });

  it("duplicate anonymous keys in { modules } are rejected", () => {
    const mConfigA = defineModule().init(() => ({ port: 80 }));
    const mConfigB = defineModule().init(() => ({ port: 8080 }));

    // @ts-expect-error: duplicate anonymous key 'port'
    defineModule({ modules: [mConfigA, mConfigB] });
  });

  it("duplicate anonymous keys via .with() are rejected", () => {
    const mBase = defineModule().init(() => ({ sharedKey: "base" }));
    const mPlugin = defineModule().init(() => ({ sharedKey: "plugin" }));

    // @ts-expect-error: key collision 'sharedKey' in .with()
    mBase.with(mPlugin);
  });

  it("two modules sharing a { name } namespace are rejected", () => {
    const serviceA = defineModule({ name: "api" }).init(() => ({ get: true }));
    const serviceB = defineModule({ name: "api" }).init(() => ({ post: true }));

    // @ts-expect-error: two modules both named 'api'
    defineModule({ modules: [serviceA, serviceB] });
  });

  it("async init return value is unwrapped in ctx, not left as a Promise", () => {
    defineModule().init(async () => ({ asyncValue: 42 }), {
      afterBoot: (ctx) => {
        const val: number = ctx.asyncValue;

        // @ts-expect-error: asyncValue is number, not Promise<number>
        const valBad: Promise<number> = ctx.asyncValue;
      },
    });
  });

  it("named module ctx is namespaced, not flat-merged", () => {
    const userMod = defineModule({ name: "user" }).init(() => ({
      find: (id: string) => ({ id, name: "Alice" }),
    }));

    defineModule({ modules: [userMod] }).init((ctx) => {
      const name = ctx.user.find("1").name;

      // @ts-expect-error: own slice is not flat-merged into ctx
      ctx.find;

      return {};
    });
  });

  it("init return value colliding with a dep ctx key is rejected", () => {
    const portMod = defineModule().init(() => ({ port: 3000 }));

    defineModule({ modules: [portMod] }).init(
      // @ts-expect-error: returning 'port' conflicts with dep ctx key 'port'
      () => ({ port: 9999 })
    );
  });

  it("lifecycle hooks receive the correctly-shaped ctx at each phase", () => {
    const logMod = defineModule().init(() => ({ log: (msg: string) => msg }));

    defineModule({ modules: [logMod], name: "app" }).init(
      (ctx) => {
        const _log = ctx.log; // dep ctx available in initFn
        return { started: true };
      },
      {
        beforeBoot: (ctx) => {
          // beforeBoot receives dep ctx only (before own slice exists)
          const _log = ctx.log;

          // @ts-expect-error: own slice not yet mounted
          ctx.app;
        },
        afterBoot: (ctx) => {
          // afterBoot receives post-boot ctx (dep ctx + own slice under name)
          const _started: boolean = ctx.app.started;
          const _log = ctx.log;

          // @ts-expect-error: non-existent key
          ctx.nonExistent;
        },
        shutdown: (ctx) => {
          // shutdown gets the same post-boot ctx
          const _started: boolean = ctx.app.started;
        },
      }
    );
  });

  it(".with() chaining accumulates all keys into a flat ctx type", () => {
    const modA = defineModule().init(() => ({ a: 1 }));
    const modB = defineModule().init(() => ({ b: "hello" }));
    const modC = defineModule().init(() => ({ c: true }));

    const composed = modA.with(modB).with(modC);
    type ComposedCtx = ContextOf<typeof composed>;

    composed.start().then(({ ctx }) => {
      const _a: number = ctx.a;
      const _b: string = ctx.b;
      const _c: boolean = ctx.c;

      // @ts-expect-error: key not in any composed module
      ctx.nonExistent;
    });
  });

  it(".with() collision is detected across the whole chain", () => {
    const modX = defineModule().init(() => ({ x: 1 }));
    const modXDup = defineModule().init(() => ({ x: 2 }));

    // @ts-expect-error: 'x' collides across .with() chain
    modX.with(modXDup);
  });

  it("ModuleDeclaration.start() works without calling .init() first", () => {
    const depMod = defineModule().init(() => ({ ready: true }));

    defineModule({ modules: [depMod] })
      .start()
      .then(({ ctx }) => {
        const _ready: boolean = ctx.ready;

        // @ts-expect-error: key not contributed by any module
        ctx.nonExistent;
      });
  });

  it("ModuleDeclaration.with() works without calling .init() first", () => {
    const depMod = defineModule().init(() => ({ ready: true }));
    const extraMod = defineModule().init(() => ({ extra: 42 }));

    const composed = defineModule({ modules: [depMod] }).with(extraMod);

    composed.start().then(({ ctx }) => {
      const _ready: boolean = ctx.ready;
      const _extra: number = ctx.extra;

      // @ts-expect-error: key not contributed
      ctx.nonExistent;
    });
  });

  it("ignoreConflicts allows a shared name and deep-merges the ctx type", () => {
    const routesA = defineModule({ name: "routes" }).init(() => ({
      user: { GET: () => "list users" },
    }));
    const routesB = defineModule({ name: "routes" }).init(() => ({
      post: { GET: () => "list posts" },
    }));
    const routesC = defineModule({}).init(() => ({
      routes: { post: { GETC: () => "list posts" } },
    }));

    // Without ignoreConflicts this would be a @ts-expect-error
    const appWithRoutes = defineModule({
      modules: [routesA, routesB],
      ignoreConflicts: ["routes"],
    })
      .init((ctx) => {
        const _userGet = ctx.routes.user.GET;
        const _postGet = ctx.routes.post.GET;

        // @ts-expect-error: key not in any merged routes slice
        ctx.routes.nonExistent;

        return {};
      })
      .with(routesC);

    type AppWithRoutesCtx = ContextOf<typeof appWithRoutes>;
    type RoutesUserCtx = ContextOf<typeof appWithRoutes>["routes"]["user"];
  });

  it("ignoreConflicts does not silence collisions on non-ignored names", () => {
    const conflictA = defineModule({ name: "routes" }).init(() => ({ x: 1 }));
    const conflictB = defineModule({ name: "db" }).init(() => ({ y: 2 }));
    const conflictC = defineModule({ name: "db" }).init(() => ({ z: 3 }));

    defineModule({
      // @ts-expect-error: 'db' is not ignored, collision must still be detected
      modules: [conflictA, conflictB, conflictC],
      ignoreConflicts: ["routes"],
    });
  });

  it("a module name that shadows a dep ctx key is rejected", () => {
    const flatMod = defineModule().init(() => ({ db: { port: 5432 } }));

    defineModule({
      // @ts-expect-error: name 'db' already exists as a key contributed by flatMod
      name: "db",
      modules: [flatMod],
    }).init(() => ({}));
  });

  it("stop() accepts an optional, correctly-typed reason", () => {
    defineModule()
      .init(() => ({ value: 1 }))
      .start()
      .then(({ ctx, stop }) => {
        const _value: number = ctx.value;

        stop("graceful shutdown");
        stop();

        // @ts-expect-error: ctx has no such key
        ctx.nonExistent;
      });
  });

  it("transitive dep ctx is exposed to downstream consumers", () => {
    const level1 = defineModule().init(() => ({ l1: "level1" }));
    const level2 = defineModule({ modules: [level1] }).init((ctx) => {
      const _l1: string = ctx.l1; // visible here, level2 is a direct consumer
      return { l2: "level2" };
    });

    defineModule({ modules: [level2] }).init((ctx) => {
      const _l2: string = ctx.l2; // level2's own slice is flat-merged

      ctx.l1; // visbile here
    });
  });

  it("passing both a name-colliding and a slice-colliding module to .with() is rejected", () => {
    const moduleA = defineModule({ name: "moduleA" }).init(() => ({ a: 1 }));
    const moduleB = defineModule({ name: "moduleA" }).init<{ a: number }>(
      (ctx) => ({ a: 2 })
    );

    defineModule({})
      .init(() => ({}))
      // @ts-expect-error: both modules resolve to the 'moduleA' namespace
      .with(moduleA, moduleB);

    // @ts-expect-error: same collision via { modules }
    defineModule({ modules: [moduleA, moduleB] }).init((ctx) => {
      return {};
    });
  });

  it("a dependency's slice is visible on ctx by name inside initFn", () => {
    const moduleA = defineModule({ name: "moduleA" }).init(() => ({ a: 1 }));

    defineModule({ modules: [moduleA] }).init((ctx) => {
      ctx.moduleA.a;
      return {};
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Basic usage walkthrough
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Basic usage walkthrough", () => {
  it("supports find/lookup style modules composed with .with()", async () => {
    const userModule = defineModule({ name: "user" }).init(() => {
      const users = [{ id: 1, name: "Alice" }];
      return {
        findUser(id: number) {
          return users.find((user) => user.id === id);
        },
      };
    });

    const loggerModule = defineModule({ name: "logger" }).init(() => ({
      log: vi.fn(),
    }));

    const app = defineModule().with(userModule, loggerModule);
    const { ctx } = await app.start();

    ctx.logger.log("Application started");
    expect(ctx.user.findUser(1)?.name).toBe("Alice");
    expect(ctx.logger.log).toHaveBeenCalledWith("Application started");
  });

  it("supports nesting a fully-composed app as a dependency of another module", async () => {
    const userModule = defineModule({ name: "user" }).init(() => ({
      findUser: (id: number) => (id === 1 ? { id, name: "Alice" } : undefined),
    }));
    const App = defineModule({ modules: [userModule] }).init();
    const outer = defineModule({ modules: [App] });
    const { ctx } = await outer.start();

    expect(ctx.user.findUser(1)?.name).toBe("Alice");
  });

  it("merges anonymous modules combined via { modules } + .init() and via .with()", async () => {
    const hello = defineModule().init(() => ({ greet: "hello" }));
    const name = defineModule().init(() => ({ name: "tsdkarc" }));

    const viaModules = await defineModule({ modules: [hello, name] })
      .init()
      .start();
    expect(`${viaModules.ctx.greet}, ${viaModules.ctx.name}!`).toBe(
      "hello, tsdkarc!"
    );

    const viaWith = await defineModule().with(hello, name).start();
    expect(`${viaWith.ctx.greet}, ${viaWith.ctx.name}!`).toBe(
      "hello, tsdkarc!"
    );
    await viaWith.stop();
  });

  it("ignoreConflicts allows same-named modules to coexist and deep-merge", async () => {
    const module1 = defineModule({ name: "example" }).init(() => ({
      test: "value1",
    }));
    const module2 = defineModule({ name: "example" }).init(() => ({
      test2: "value2",
    }));

    const { ctx } = await defineModule({ ignoreConflicts: ["example"] })
      .with(module1, module2)
      .start();

    expect(ctx.example.test).toBe("value1");
    expect(ctx.example.test2).toBe("value2");
  });

  it("prints a readable dependency graph via .graph()", () => {
    const db = defineModule({ name: "db" }).init(() => ({ uri: "db" }));
    const cache = defineModule({ name: "cache" }).init(() => ({
      msg: "cache",
    }));
    const app = defineModule({ name: "app", modules: [db, cache] }).init(
      () => ({})
    );

    expect(app.graph().formatted.trim()).toBe(`- app
  - db
  - cache`);
  });

  it("supports classes that receive resolved dependencies via constructor injection", async () => {
    const loggerModule = defineModule().init(() => ({
      logger: { log: vi.fn() },
    }));
    type Logger = ContextOf<typeof loggerModule>["logger"];

    class UserService {
      constructor(private logger: Logger) {}
      createUser(name: string) {
        this.logger.log(`Creating user: ${name}`);
      }
    }

    const userServiceModule = defineModule({
      name: "userService",
      modules: [loggerModule],
    }).init((ctx) => new UserService(ctx.logger));

    const appModule = defineModule({
      name: "app",
      modules: [userServiceModule, loggerModule],
    }).init(() => ({}));

    const app = await appModule.start();
    app.ctx.userService.createUser("Alice");

    expect(app.ctx.logger.log).toHaveBeenCalledWith("Creating user: Alice");
    await app.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Context merging & initialization
// ─────────────────────────────────────────────────────────────────────────────

describe("2. Context merging & initialization", () => {
  it("merges anonymous module slices into a flat root context", async () => {
    const m1 = defineModule().init(() => ({ port: 8080 }));
    const m2 = defineModule().init(() => ({ host: "localhost" }));
    const app = defineModule({ modules: [m1, m2] }).init();
    const { ctx } = await app.start();

    expect(ctx.port).toBe(8080);
    expect(ctx.host).toBe("localhost");
  });

  it("isolates context under a namespace when using { name }", async () => {
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

  it("returns an empty ctx when no modules are provided and init returns nothing", async () => {
    const { ctx } = await defineModule().init().start();
    expect(ctx).toEqual({});
  });

  it("supports init returning void, contributing no slice", async () => {
    const sideEffect = vi.fn();
    const m = defineModule().init(() => {
      sideEffect();
    });
    const { ctx } = await m.start();

    expect(sideEffect).toHaveBeenCalledOnce();
    expect(ctx).toEqual({});
  });

  it("allows multiple named modules to coexist without key pollution", async () => {
    const modA = defineModule({ name: "a" }).init(() => ({ value: 1 }));
    const modB = defineModule({ name: "b" }).init(() => ({ value: 2 }));
    const { ctx } = await modA.with(modB).start();

    expect(ctx.a.value).toBe(1);
    expect(ctx.b.value).toBe(2);
    // @ts-ignore
    expect(ctx.value).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Composition via .with()
// ─────────────────────────────────────────────────────────────────────────────

describe("3. Composition via .with()", () => {
  it("composes sibling modules and merges their slices", async () => {
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

  it("composes multiple modules via .with() and merges all slices", async () => {
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

  it("chains .with() calls and accumulates all keys", async () => {
    const modA = defineModule().init(() => ({ a: 1 }));
    const modB = defineModule().init(() => ({ b: 2 }));
    const modC = defineModule().init(() => ({ c: 3 }));
    const { ctx } = await modA.with(modB).with(modC).start();

    expect(ctx.a).toBe(1);
    expect(ctx.b).toBe(2);
    expect(ctx.c).toBe(3);
  });

  it("supports .with() directly on a ModuleDeclaration without calling .init()", async () => {
    const extra = defineModule().init(() => ({ extra: 99 }));
    const { ctx } = await defineModule().with(extra).start();

    expect(ctx.extra).toBe(99);
  });

  it("groups two named-dependency modules so ctx contains both slices", async () => {
    const moduleA = defineModule({ name: "moduleA" }).init(() => ({
      value: "module:A",
    }));
    const moduleB = defineModule({ name: "moduleB", modules: [moduleA] }).init(
      (ctx) => ({ value: "module:B", echo: () => ctx.moduleA.value })
    );

    const { ctx, stop } = await moduleA.with(moduleB).start();

    expect(ctx.moduleA.value).toBe("module:A");
    expect(ctx.moduleB.value).toBe("module:B");
    await stop();
  });

  it("does not boot a module shared by two .with() siblings more than once", async () => {
    let bootCount = 0;
    const shared = defineModule({ name: "shared" }).init(() => {
      bootCount++;
      return { v: "shared" };
    });
    const left = defineModule({ name: "left", modules: [shared] }).init(
      (ctx) => ({ l: ctx.shared.v })
    );
    const right = defineModule({ name: "right", modules: [shared] }).init(
      (ctx) => ({ r: ctx.shared.v })
    );

    const { stop } = await left.with(right).start();

    expect(bootCount).toBe(1);
    await stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ModuleDeclaration shortcuts (.start() / .with() without .init())
// ─────────────────────────────────────────────────────────────────────────────

describe("4. ModuleDeclaration shortcuts", () => {
  it("allows .start() directly on a declaration without .init()", async () => {
    const dep = defineModule().init(() => ({ ready: true }));
    const { ctx } = await defineModule({ modules: [dep] }).start();

    expect(ctx.ready).toBe(true);
  });

  it("allows .with() directly on a declaration and includes all keys", async () => {
    const dep = defineModule().init(() => ({ dep: true }));
    const sibling = defineModule().init(() => ({ sibling: true }));
    const { ctx } = await defineModule({ modules: [dep] })
      .with(sibling)
      .start();

    expect(ctx.dep).toBe(true);
    expect(ctx.sibling).toBe(true);
  });

  it("declaration .start() ctx contains only dep modules' slices", async () => {
    const m = defineModule().init(() => ({ value: 42 }));
    const { ctx } = await defineModule({ modules: [m] }).start();

    expect(ctx.value).toBe(42);
    // @ts-ignore
    expect(ctx.nonExistent).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Dependency context cascading
// ─────────────────────────────────────────────────────────────────────────────

describe("5. Dependency context cascading", () => {
  it("passes accumulated context to initFn of subsequent modules", async () => {
    const configMod = defineModule().init(() => ({ port: 3000 }));
    const serverMod = defineModule({ modules: [configMod] }).init((ctx) => ({
      serverUrl: `http://localhost:${ctx.port}`,
    }));
    const { ctx } = await serverMod.start();

    expect(ctx.serverUrl).toBe("http://localhost:3000");
  });

  it("handles deeply nested module dependencies", async () => {
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

  it("boots the full transitive dependency graph for a 3-level chain", async () => {
    const moduleA = defineModule({ name: "moduleA" }).init(() => ({
      value: "module:A",
    }));
    const moduleB = defineModule({ name: "moduleB", modules: [moduleA] }).init(
      (ctx) => ({ value: "module:B", echo: () => ctx.moduleA.value })
    );
    const moduleC = defineModule({ name: "moduleC", modules: [moduleB] }).init(
      (ctx) => ({ value: `module:C sees ${ctx.moduleB.value}` })
    );

    const { ctx, stop } = await moduleC.start();

    expect(ctx.moduleB.value).toBe("module:B");
    expect(ctx.moduleC.value).toBe("module:C sees module:B");
    await stop();
  });

  it("does not expose transitive deps to downstream consumers", async () => {
    const level1 = defineModule().init(() => ({ internal: "secret" }));
    const level2 = defineModule({ modules: [level1] }).init(() => ({
      public: "exposed",
    }));
    const { ctx } = await level2.start();

    expect(ctx.public).toBe("exposed");
    expect(ctx.internal).toBe("secret");
  });

  it("deduplicates a dep shared by two consumers, booting it exactly once", async () => {
    const initSpy = vi.fn(() => ({ shared: true }));
    const sharedMod = defineModule().init(initSpy);

    const consumerA = defineModule({ modules: [sharedMod] }).init(() => ({
      a: true,
    }));
    const consumerB = defineModule({ modules: [sharedMod] }).init(() => ({
      b: true,
    }));

    await consumerA.with(consumerB).start();

    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Named vs anonymous module context shape
// ─────────────────────────────────────────────────────────────────────────────

describe("6. Named vs anonymous module context shape", () => {
  it("named module: ctx is keyed by name", async () => {
    const moduleA = defineModule({ name: "moduleA" }).init(() => ({
      value: "module:A",
    }));
    const { ctx, stop } = await moduleA.start();

    expect(ctx.moduleA.value).toBe("module:A");
    await stop();
  });

  it("anonymous module: own slice is merged flat into ctx", async () => {
    const anonMod = defineModule().init(() => ({ anonValue: "i am anon" }));
    const { ctx, stop } = await anonMod.start();

    expect(ctx.anonValue).toBe("i am anon");
    await stop();
  });

  it("anonymous module with deps: receives dep ctx and still merges flat", async () => {
    const moduleA = defineModule({ name: "moduleA" }).init(() => ({
      value: "module:A",
    }));
    const anonWithDeps = defineModule({ modules: [moduleA] }).init((ctx) => ({
      derivedValue: `derived from ${ctx.moduleA.value}`,
    }));
    const { ctx, stop } = await anonWithDeps.start();

    expect(ctx.moduleA.value).toBe("module:A");
    expect(ctx.derivedValue).toBe("derived from module:A");
    await stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Asynchronous operations
// ─────────────────────────────────────────────────────────────────────────────

describe("7. Asynchronous operations", () => {
  it("awaits an async initFn before boot completes", async () => {
    const asyncMod = defineModule().init(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { isReady: true };
    });
    const { ctx } = await asyncMod.start();

    expect(ctx.isReady).toBe(true);
  });

  it("resolves async slices before passing ctx to dependent modules", async () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// 8. Lifecycle hook ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("8. Lifecycle hook ordering", () => {
  it("executes local beforeBoot/init/afterBoot in order", async () => {
    const order: string[] = [];
    const m = defineModule().init(
      () => {
        order.push("init");
        return {};
      },
      {
        beforeBoot: () => order.push("beforeBoot"),
        afterBoot: () => order.push("afterBoot"),
      }
    );
    await m.start();

    expect(order).toEqual(["beforeBoot", "init", "afterBoot"]);
  });

  it("interleaves global and local boot hooks in dependency order", async () => {
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

  it("afterBoot hook receives the post-boot ctx including its own slice", async () => {
    const received: unknown[] = [];
    const m = defineModule({ name: "svc" }).init(() => ({ running: true }), {
      afterBoot: (ctx) => {
        received.push(ctx);
      },
    });
    await m.start();

    expect(received[0]).toMatchObject({ svc: { running: true } });
  });

  it("fires local and global boot/shutdown hooks in the fully-interleaved order", async () => {
    const log: string[] = [];
    const m = defineModule({ name: "hookMod" }).init(() => ({ v: 42 }), {
      beforeBoot: () => log.push("mod:beforeBoot"),
      afterBoot: (ctx) => log.push(`mod:afterBoot:v=${ctx.hookMod.v}`),
      beforeShutdown: (ctx) =>
        log.push(`mod:beforeShutdown:v=${ctx.hookMod.v}`),
      afterShutdown: (ctx) => log.push(`mod:afterShutdown:v=${ctx.hookMod.v}`),
    });

    const { stop } = await m.start({
      beforeBoot: () => log.push("global:beforeBoot"),
      afterBoot: (ctx) => log.push(`global:afterBoot:v=${ctx.hookMod.v}`),
      beforeEachBoot: (_ctx, mod) => log.push(`global:beforeEach:${mod.name}`),
      afterEachBoot: (_ctx, mod) => log.push(`global:afterEach:${mod.name}`),
      beforeShutdown: (ctx) =>
        log.push(`global:beforeShutdown:v=${ctx.hookMod.v}`),
      afterShutdown: (ctx) =>
        log.push(`global:afterShutdown:v=${ctx.hookMod.v}`),
      beforeEachShutdown: (_ctx, mod) =>
        log.push(`global:beforeEachShutdown:${mod.name}`),
      afterEachShutdown: (_ctx, mod) =>
        log.push(`global:afterEachShutdown:${mod.name}`),
    });
    await stop();

    expect(log).toEqual([
      "global:beforeBoot",
      "global:beforeEach:hookMod",
      "mod:beforeBoot",
      "mod:afterBoot:v=42",
      "global:afterEach:hookMod",
      "global:afterBoot:v=42",
      "global:beforeShutdown:v=42",
      "global:beforeEachShutdown:hookMod",
      "mod:beforeShutdown:v=42",
      "mod:afterShutdown:v=42",
      "global:afterEachShutdown:hookMod",
      "global:afterShutdown:v=42",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Shutdown sequences
// ─────────────────────────────────────────────────────────────────────────────

describe("9. Shutdown sequences", () => {
  it("executes shutdown hooks when stop() is called", async () => {
    const order: string[] = [];
    const m = defineModule().init(() => ({}), {
      beforeShutdown: (_ctx, reason) => order.push(`beforeShutdown:${reason}`),
      shutdown: () => order.push("shutdown"),
      afterShutdown: () => order.push("afterShutdown"),
    });
    const { stop } = await m.start();
    await stop("SIGINT");

    expect(order).toEqual([
      "beforeShutdown:SIGINT",
      "shutdown",
      "afterShutdown",
    ]);
  });

  it("shuts down sibling modules composed via .with() in LIFO order", async () => {
    const order: string[] = [];
    const m1 = defineModule().init(() => ({}), {
      shutdown: () => order.push("m1_shutdown"),
    });
    const m2 = defineModule().init(() => ({}), {
      shutdown: () => order.push("m2_shutdown"),
    });
    const m3 = defineModule().init(() => ({}), {
      shutdown: () => order.push("m3_shutdown"),
    });

    const { stop } = await m1.with(m2, m3).start();
    await stop();

    expect(order).toEqual(["m3_shutdown", "m2_shutdown", "m1_shutdown"]);
  });

  it("shuts down a dependency chain in exact reverse of boot order", async () => {
    const order: string[] = [];
    const sA = defineModule({ name: "sA" }).init(() => ({ v: "A" }), {
      shutdown: () => order.push("sA"),
    });
    const sB = defineModule({ name: "sB", modules: [sA] }).init(
      () => ({ v: "B" }),
      { shutdown: () => order.push("sB") }
    );
    const sC = defineModule({ name: "sC", modules: [sB] }).init(
      () => ({ v: "C" }),
      { shutdown: () => order.push("sC") }
    );

    const { stop } = await sC.start();
    await stop();

    expect(order).toEqual(["sC", "sB", "sA"]);
  });

  it("passes the stop reason to every local shutdown hook", async () => {
    const reasons: unknown[] = [];
    const m = defineModule().init(() => ({}), {
      beforeShutdown: (_ctx, r) => reasons.push(r),
      shutdown: (_ctx, r) => reasons.push(r),
      afterShutdown: (_ctx, r) => reasons.push(r),
    });
    const { stop } = await m.start();
    await stop("SIGTERM");

    expect(reasons).toEqual(["SIGTERM", "SIGTERM", "SIGTERM"]);
  });

  it("passes a typed stop reason through to a module's shutdown hook", async () => {
    let received: string | undefined;
    const m = defineModule({ name: "reasonMod" }).init(() => ({ v: 1 }), {
      shutdown(_ctx, reason) {
        received = reason;
      },
    });

    const { stop } = await m.start<string>();
    await stop("SIGTERM");

    expect(received).toBe("SIGTERM");
  });

  it("passes a typed stop reason to global beforeShutdown/afterShutdown", async () => {
    const reasons: (string | undefined)[] = [];
    const m = defineModule({ name: "r2" }).init(() => ({}));

    const { stop } = await m.start<string>({
      beforeShutdown: (_ctx, r) => reasons.push(r),
      afterShutdown: (_ctx, r) => reasons.push(r),
    });
    await stop("SIGINT");

    expect(reasons).toEqual(["SIGINT", "SIGINT"]);
  });

  it("runs global shutdown hooks around per-module shutdown hooks", async () => {
    const order: string[] = [];
    const m = defineModule().init(() => ({}), {
      shutdown: () => order.push("local_shutdown"),
    });

    const { stop } = await m.start({
      beforeShutdown: () => order.push("global_beforeShutdown"),
      beforeEachShutdown: () => order.push("global_beforeEachShutdown"),
      afterEachShutdown: () => order.push("global_afterEachShutdown"),
      afterShutdown: () => order.push("global_afterShutdown"),
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

// ─────────────────────────────────────────────────────────────────────────────
// 10. Error handling & rollback
// ─────────────────────────────────────────────────────────────────────────────

describe("10. Error handling & rollback", () => {
  it("aborts startup and rolls back already-booted modules on a later failure", async () => {
    const order: string[] = [];
    const m1 = defineModule().init(
      () => {
        order.push("m1_init");
        return { m1: true };
      },
      { shutdown: () => order.push("m1_shutdown") }
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

  it("cleans up booted modules in reverse boot order on failure", async () => {
    const sequence: string[] = [];
    const m1 = defineModule().init(() => ({}), {
      afterBoot: () => sequence.push("m1_booted"),
      shutdown: () => sequence.push("m1_shutdown"),
    });
    const m2 = defineModule().init(async () => {
      throw new Error("m2 exploded");
    });

    const root = defineModule({ modules: [m1, m2] });
    await expect(root.init().start()).rejects.toThrow("m2 exploded");

    expect(sequence).toEqual(["m1_booted", "m1_shutdown"]);
  });

  it("forwards the thrown error as the rollback reason to shutdown hooks", async () => {
    const rollbackReasons: unknown[] = [];
    const boom = new Error("boom");

    const m1 = defineModule().init(() => ({}), {
      shutdown: (_ctx, reason) => rollbackReasons.push(reason),
    });
    const m2 = defineModule().init(() => {
      throw boom;
    });

    const app = defineModule({ modules: [m1, m2] }).init();
    await expect(app.start()).rejects.toThrow("boom");

    expect(rollbackReasons).toEqual([boom]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. ignoreConflicts — runtime deep merge
// ─────────────────────────────────────────────────────────────────────────────

describe("11. ignoreConflicts — runtime deep merge", () => {
  it("deep-merges slices of modules sharing the same name", async () => {
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

    expect(ctx.routes.user.GET()).toBe("list users");
    expect(ctx.routes.post.GET()).toBe("list posts");
  });

  it("applies last-write-wins on leaf collisions within an ignored key", async () => {
    const modA = defineModule({ name: "cfg" }).init(() => ({
      timeout: 1000,
      retries: 3,
    }));
    const modB = defineModule({ name: "cfg" }).init(() => ({ timeout: 5000 }));

    const { ctx } = await defineModule({
      modules: [modA, modB],
      ignoreConflicts: ["cfg"],
    }).start();

    expect(ctx.cfg.timeout).toBe(5000);
    expect(ctx.cfg.retries).toBe(3);
  });

  it("deep-merges more than two modules sharing the same ignored name", async () => {
    const a = defineModule({ name: "store" }).init(() => ({ a: 1 }));
    const b = defineModule({ name: "store" }).init(() => ({ b: 2 }));
    const c = defineModule({ name: "store" }).init(() => ({ c: 3 }));

    const { ctx } = await defineModule({
      modules: [a, b, c],
      ignoreConflicts: ["store"],
    }).start();

    expect(ctx.store).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("throws a collision error for anonymous keys not listed in ignoreConflicts", async () => {
    const portA = defineModule().init(() => ({ port: 80 }));
    const portB = defineModule().init(() => ({ port: 443 }));

    // @ts-expect-error - type-level collision; also throws at runtime
    const app = defineModule({ modules: [portA, portB] }).init();
    await expect(app.start()).rejects.toThrow(/collision/i);
  });

  it("recursively deep-merges nested objects under an ignored key", async () => {
    const a = defineModule({ name: "config" }).init(() => ({
      db: { host: "localhost", port: 5432 },
    }));
    const b = defineModule({ name: "config" }).init(() => ({
      db: { port: 5433, ssl: true },
    }));

    const { ctx } = await defineModule({
      modules: [a, b],
      ignoreConflicts: ["config"],
    }).start();

    expect(ctx.config.db).toEqual({ host: "localhost", port: 5433, ssl: true });
  });

  it("ignores conflicts declared via defineModule({ ignoreConflicts }).with(...)", async () => {
    const database = defineModule({ name: "database" }).init(() => ({
      uri: "real database URI",
      id1: 1,
    }));
    const fakeDatabase = defineModule({ name: "database" }).init(() => ({
      uri: "fake database URI",
      id2: 2,
    }));

    const { ctx } = await defineModule({ ignoreConflicts: ["database"] })
      .with(database, fakeDatabase)
      .start();

    expect(ctx.database.uri).toBe("fake database URI");
    expect(ctx.database.id1).toBe(1);
    expect(ctx.database.id2).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Circular dependency guard
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Circular graphs cannot be constructed through the public typed API, so
 * both tests build the internal `__node` structure by hand to exercise the
 * runtime cycle detector directly.
 */

describe("12. Circular dependency guard", () => {
  it("throws a clear error when a composite module's members form a cycle", async () => {
    const nodeA: any = {
      name: "circA",
      deps: [],
      boot: () => ({}),
      composite: false,
      members: undefined,
    };
    const nodeB: any = {
      name: "circB",
      deps: [nodeA],
      boot: () => ({}),
      composite: false,
      members: undefined,
    };
    nodeA.deps.push(nodeB); // create the cycle

    const realMod = defineModule({ name: "wrapper" }).init(() => ({}));
    (realMod as any).__node.composite = true;
    (realMod as any).__node.members = [nodeA, nodeB];

    await expect((realMod as any).start()).rejects.toThrowError(
      /Circular dependency detected at module "circA"/
    );
  });

  it("throws at boot time for a two-node dependency cycle passed via { modules }", async () => {
    const nodeA: any = { __node: null };
    const nodeB: any = { __node: null };

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
    nodeA.__node.deps = [nodeB.__node]; // create the cycle

    // @ts-expect-error
    const app = defineModule({ modules: [nodeA, nodeB] }).init();
    await expect(app.start()).rejects.toThrow(/[Cc]ircular/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Edge cases & robustness
// ─────────────────────────────────────────────────────────────────────────────

describe("13. Edge cases & robustness", () => {
  it("passes context through deeply nested modules correctly", async () => {
    const mCore = defineModule({ name: "core" }).init(() => ({
      version: "1.0",
    }));
    const mDb = defineModule({ modules: [mCore] }).init((ctx) => ({
      dbUrl: `url_v${ctx.core.version}`,
    }));
    const mBiz = defineModule({ name: "biz", modules: [mDb] }).init((ctx) => ({
      status: ctx.dbUrl === "url_v1.0" ? "ok" : "fail",
    }));
    const { ctx } = await mBiz.start();

    expect(ctx.biz.status).toBe("ok");
  });

  it("handles a module with no initFn and no hooks without errors", async () => {
    const empty = defineModule().init();
    const { ctx, stop } = await empty.start();

    expect(ctx).toEqual({});
    await expect(stop()).resolves.toBeUndefined();
  });

  it("allows stop() to be called multiple times without throwing", async () => {
    const { stop } = await defineModule().init().start();

    await expect(stop()).resolves.toBeUndefined();
    await expect(stop()).resolves.toBeUndefined();
  });

  it("supports async shutdown hooks", async () => {
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. deepMerge security & correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("14. deepMerge security & correctness", () => {
  it("does not pollute Object.prototype via __proto__", () => {
    const malicious = JSON.parse(`{ "__proto__": { "polluted": true } }`);

    deepMerge({}, malicious);

    expect(({} as any).polluted).toBeUndefined();
  });

  it("blocks nested __proto__ pollution", () => {
    const malicious = { database: { __proto__: { polluted: true } } };

    deepMerge({}, malicious);

    expect(({} as any).polluted).toBeUndefined();
  });

  it("blocks constructor.prototype pollution", () => {
    const malicious = { constructor: { prototype: { polluted: true } } };

    deepMerge({}, malicious);

    expect(({} as any).polluted).toBeUndefined();
  });

  it("does not mutate source objects", () => {
    const a = { database: { host: "localhost" } };
    const b = { database: { port: 3306 } };

    deepMerge(a, b);

    expect(a).toEqual({ database: { host: "localhost" } });
    expect(b).toEqual({ database: { port: 3306 } });
  });

  it("creates new nested objects rather than reusing input references", () => {
    const a = { config: { host: "localhost" } };
    const b = { config: { port: 3306 } };

    const result = deepMerge(a, b);

    expect(result.config).not.toBe(a.config);
    expect(result.config).not.toBe(b.config);
  });

  it("replaces arrays instead of merging them element-wise", () => {
    const result = deepMerge({ items: [1, 2] }, { items: [3, 4] });

    expect(result.items).toEqual([3, 4]);
  });

  it("replaces Date objects instead of recursively merging them", () => {
    const date = new Date();

    const result = deepMerge({ value: date }, { value: { foo: "bar" } });

    expect(result.value).toEqual({ foo: "bar" });
  });

  it("merges plain objects recursively", () => {
    const result = deepMerge(
      { database: { host: "localhost" } },
      { database: { port: 3306 } }
    );

    expect(result).toEqual({ database: { host: "localhost", port: 3306 } });
  });

  it("uses last-write-wins semantics on leaf collisions", () => {
    const result = deepMerge(
      { uri: "real database URI" },
      { uri: "fake database URI" }
    );

    expect(result.uri).toBe("fake database URI");
  });

  it("supports merging null-prototype objects", () => {
    const a = Object.create(null);
    a.id1 = 1;
    const b = Object.create(null);
    b.id2 = 2;

    const result = deepMerge(a, b);

    expect(result).toEqual({ id1: 1, id2: 2 });
  });

  it("handles deeply nested objects without stack overflow", () => {
    const createDeepObject = (depth: number) => {
      let obj: any = { value: true };
      for (let i = 0; i < depth; i++) obj = { child: obj };
      return obj;
    };

    expect(() => {
      deepMerge({}, createDeepObject(1000));
    }).not.toThrow();
  });

  it("evaluates getter properties on the source object during merge", () => {
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
