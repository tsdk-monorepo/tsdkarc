import { defineModule } from "../src/core";
import { ContextOf } from "../src/types";

// ─────────────────────────────────────────────────────────────────────────────
// Baseline: empty module ctx is empty
// ─────────────────────────────────────────────────────────────────────────────

defineModule().init((ctx) => {
  // @ts-expect-error: empty ctx has no keys
  ctx.something_not_exist;
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Context Type Inference & Dependency Consumption
// ─────────────────────────────────────────────────────────────────────────────

const dbMod = defineModule().init(() => ({ dbPort: 5432 }));
const cacheMod = defineModule().init(() => ({ cachePort: 6379 }));

defineModule({ modules: [dbMod, cacheMod] }).init((ctx) => {
  const p1: number = ctx.dbPort;
  const p2: number = ctx.cachePort;

  // @ts-expect-error: non-existent key
  const p3 = ctx.nonExist;

  return { status: "ok" };
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Duplicate Key Detection in defineModule { modules }
// ─────────────────────────────────────────────────────────────────────────────

const mConfigA = defineModule().init(() => ({ port: 80 }));
const mConfigB = defineModule().init(() => ({ port: 8080 }));

// @ts-expect-error: duplicate anonymous key 'port'
defineModule({ modules: [mConfigA, mConfigB] });

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Duplicate Key Detection via .with()
// ─────────────────────────────────────────────────────────────────────────────

const mBase = defineModule().init(() => ({ sharedKey: "base" }));
const mPlugin = defineModule().init(() => ({ sharedKey: "plugin" }));

// @ts-expect-error: key collision 'sharedKey' in .with()
mBase.with(mPlugin);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Collision Detection for Named Namespaces { name }
// ─────────────────────────────────────────────────────────────────────────────

const serviceA = defineModule({ name: "api" }).init(() => ({ get: true }));
const serviceB = defineModule({ name: "api" }).init(() => ({ post: true }));

// @ts-expect-error: two modules both named 'api'
defineModule({ modules: [serviceA, serviceB] });

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Async Init — Promise is unwrapped in ctx
// ─────────────────────────────────────────────────────────────────────────────

defineModule().init(async () => ({ asyncValue: 42 }), {
  afterBoot: (ctx) => {
    const val: number = ctx.asyncValue;

    // @ts-expect-error: asyncValue is number, not Promise<number>
    const valBad: Promise<number> = ctx.asyncValue;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Named Module — ctx is namespaced, not flat
// ─────────────────────────────────────────────────────────────────────────────

const userMod = defineModule({ name: "user" }).init(() => ({
  find: (id: string) => ({ id, name: "Alice" }),
}));

defineModule({ modules: [userMod] }).init((ctx) => {
  // Correctly namespaced under ctx.user
  const name = ctx.user.find("1").name;

  // @ts-expect-error: own slice is not flat-merged into ctx
  ctx.find;

  return {};
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: init return value collides with dep ctx key (FindSliceCollision)
// ─────────────────────────────────────────────────────────────────────────────

const portMod = defineModule().init(() => ({ port: 3000 }));

defineModule({ modules: [portMod] }).init(
  // @ts-expect-error: returning 'port' conflicts with dep ctx key 'port'
  () => ({ port: 9999 })
);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: Lifecycle hooks receive correct ctx types
// ─────────────────────────────────────────────────────────────────────────────

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
      // shutdown gets same post-boot ctx
      const _started: boolean = ctx.app.started;
    },
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9: .with() chaining — ctx accumulates correctly
// ─────────────────────────────────────────────────────────────────────────────

const modA = defineModule().init(() => ({ a: 1 }));
const modB = defineModule().init(() => ({ b: "hello" }));
const modC = defineModule().init(() => ({ c: true }));

const composed = modA.with(modB).with(modC);

type C = ContextOf<typeof composed>;

const modAA = defineModule().with(modA);
const modBB = defineModule().with(modB);
const modCC = defineModule().with(modC);

composed.start().then(({ ctx }) => {
  const _a: number = ctx.a;
  const _b: string = ctx.b;
  const _c: boolean = ctx.c;

  // @ts-expect-error: key not in any composed module
  ctx.nonExistent;
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10: .with() collision detected across chain
// ─────────────────────────────────────────────────────────────────────────────

const modX = defineModule().init(() => ({ x: 1 }));
const modXDup = defineModule().init(() => ({ x: 2 }));

// @ts-expect-error: 'x' collides across .with() chain
modX.with(modXDup);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 11: ModuleDeclaration shortcut — .start() without .init()
// ─────────────────────────────────────────────────────────────────────────────

const depMod = defineModule().init(() => ({ ready: true }));

// Should work without calling .init() first
defineModule({ modules: [depMod] })
  .start()
  .then(({ ctx }) => {
    const _ready: boolean = ctx.ready;

    // @ts-expect-error: key not contributed by any module
    ctx.nonExistent;
  });

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 12: ModuleDeclaration shortcut — .with() without .init()
// ─────────────────────────────────────────────────────────────────────────────

const extraMod = defineModule().init(() => ({ extra: 42 }));

// .with() directly on declaration, no .init() call needed
const composed2 = defineModule({ modules: [depMod] }).with(extraMod);

composed2.start().then(({ ctx }) => {
  const _ready: boolean = ctx.ready;
  const _extra: number = ctx.extra;

  // @ts-expect-error: key not contributed
  ctx.nonExistent;
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 13: ignoreConflicts — allows same named key, deep-merges types
// ─────────────────────────────────────────────────────────────────────────────

const routesA = defineModule({ name: "routes" }).init(() => ({
  user: { GET: () => "list users" },
}));
const routesB = defineModule({ name: "routes" }).init(() => ({
  post: { GET: () => "list posts" },
}));
const routesC = defineModule({}).init(() => ({
  routes: {
    post: { GETC: () => "list posts" },
  },
}));

// Without ignoreConflicts this would be a @ts-expect-error
const appWithRoutes = defineModule({
  modules: [routesA, routesB],
  ignoreConflicts: ["routes"],
})
  .init((ctx) => {
    // Both contributions are deep-merged under ctx.routes
    const _userGet = ctx.routes.user.GET;
    const _postGet = ctx.routes.post.GET;

    // @ts-expect-error: key not in any merged routes slice
    ctx.routes.nonExistent;

    return {};
  })
  .with(routesC);

type CC0 = ContextOf<typeof appWithRoutes>;
type CC = ContextOf<typeof appWithRoutes>["routes"]["user"];

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 14: ignoreConflicts — non-ignored keys still error
// ─────────────────────────────────────────────────────────────────────────────

const conflictA = defineModule({ name: "routes" }).init(() => ({ x: 1 }));
const conflictB = defineModule({ name: "db" }).init(() => ({ y: 2 }));
const conflictC = defineModule({ name: "db" }).init(() => ({ z: 3 }));

defineModule({
  // @ts-expect-error: 'db' is not ignored, collision must still be detected
  modules: [conflictA, conflictB, conflictC],
  ignoreConflicts: ["routes"],
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 15: NameCollisionError — module name shadows dep ctx key
// ─────────────────────────────────────────────────────────────────────────────

const flatMod = defineModule().init(() => ({ db: { port: 5432 } }));

// Naming this module "db" collides with the 'db' key already in dep ctx
defineModule({
  // @ts-expect-error: name 'db' already exists as a key contributed by flatMod
  name: "db",
  modules: [flatMod],
}).init(() => ({}));

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 16: stop() callback is typed correctly
// ─────────────────────────────────────────────────────────────────────────────

defineModule()
  .init(() => ({ value: 1 }))
  .start()
  .then(({ ctx, stop }) => {
    const _value: number = ctx.value;

    // stop accepts an optional reason
    stop("graceful shutdown");
    stop();

    // @ts-expect-error: ctx has no such key
    ctx.nonExistent;
  });

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 17: Deep dep chain — transitive ctx is NOT leaked to downstream
// ─────────────────────────────────────────────────────────────────────────────

const level1 = defineModule().init(() => ({ l1: "level1" }));
const level2 = defineModule({ modules: [level1] }).init((ctx) => {
  const _l1: string = ctx.l1; // visible here
  return { l2: "level2" };
});

// level2's consumer only sees what level2 contributes, not level1's internals
defineModule({ modules: [level2] }).init((ctx) => {
  const _l2: string = ctx.l2; // level2's own slice is flat-merged

  ctx.l1;
});
