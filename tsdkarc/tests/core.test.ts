// core.test.ts
import { describe, it, expect } from "vitest";
import { defineModule } from "../src/core";
import { ContextOf } from "../src/types";

// ─────────────────────────────────────────────────────────────────────────────
// Module definitions used across tests
// ─────────────────────────────────────────────────────────────────────────────

const moduleA = defineModule({ name: "moduleA" }).init(
  (ctx) => ({ value: "module:A" }),
  {
    // Hooks retained to ensure they don't throw, but logging removed for clean test output
    shutdown(_ctx) {},
    beforeBoot(_ctx) {},
    afterBoot(_ctx) {},
  }
);

const moduleAA = defineModule()
  .init((ctx) => ({ value: "module:B" }), {
    // Hooks retained to ensure they don't throw, but logging removed for clean test output
    shutdown(_ctx) {},
    beforeBoot(_ctx) {},
    afterBoot(_ctx) {},
  })
  .with(moduleA);

interface BSlice {
  value: string;
  echo?: () => string;
}

const moduleB = defineModule({
  name: "moduleB",
  modules: [moduleA],
}).init<BSlice>(
  (ctx) => {
    // ctx: { moduleA: { value: string } }
    return {
      value: "module:B",
      echo: () => ctx.moduleA.value,
    };
  },
  {
    shutdown(_ctx) {
      _ctx.moduleB;
    },
  }
);

const moduleAB = defineModule().init((ctx) => ({ value: "module:AB" }), {
  // Hooks retained to ensure they don't throw, but logging removed for clean test output
  shutdown(_ctx) {},
  beforeBoot(_ctx) {},
  afterBoot(_ctx) {},
});

const moduleBB = defineModule({
  modules: [moduleAB],
}).init<BSlice>(
  // @ts-expect-error
  (ctx) => {
    // ctx: { moduleA: { value: string } }
    return {
      value: "module:BB",
      echo: () => ctx.value,
    };
  },
  {
    shutdown(_ctx) {
      _ctx.value;
    },
  }
);

type TypeOfModuleACtx = ContextOf<typeof moduleA>;
type TypeOfModuleBCtx = ContextOf<typeof moduleB>;

const a: TypeOfModuleACtx = { moduleA: { value: "test" } };
const b: TypeOfModuleBCtx = {
  moduleA: { value: "test" },
  moduleB: { value: "hello" },
};

const moduleC = defineModule({ name: "moduleC", modules: [moduleB] }).init(
  (ctx) => {
    ctx.moduleB.echo;
    // ctx: { moduleA: ..., moduleB: { value, echo } }
    return { value: `module:C sees ${ctx.moduleB.value}` };
  },
  { shutdown(_ctx) {} }
);

// Anonymous module — flat merge
const anonMod = defineModule().init(() => ({ anonValue: "i am anon" }), {
  shutdown(_ctx) {},
});

// Anonymous module with deps
const anonWithDeps = defineModule({ modules: [moduleA] }).init((ctx) => {
  return { derivedValue: `derived from ${ctx.moduleA.value}` };
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Dream API", () => {
  const moduleA = defineModule({ name: "moduleA" }).init(
    () => {
      return { a: 1 };
    },
    { shutdown() {} }
  );
  const moduleB = defineModule({ name: "moduleA" }).init<{
    a: number;
  }>(
    (ctx) => {
      // ctx.moduleA;
      return { a: 2 };
    },
    {
      shutdown(ctx) {
        // ctx.moduleA.a;
      },
    }
  );

  defineModule({})
    .init(() => {
      return {};
    })
    // @ts-expect-error
    .with(moduleA, moduleB);

  // @ts-expect-error
  defineModule({ modules: [moduleA, moduleB] }).init((ctx) => {
    return {};
  });

  defineModule({ modules: [moduleA] }).init((ctx) => {
    ctx.moduleA.a;
    return {};
  });
  defineModule({ modules: [moduleA] }).init();
  defineModule({ modules: [moduleA] })
    .init()
    .with(moduleB);

  const loggerModule = defineModule().init((ctx) => ({ a: 1 }));

  it("throws at runtime with clear message", async () => {
    /** Manually wire up circular nodes, bypassing type system */
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

    // Inject cycle into a real module handle to test the sort internally
    (realMod as any).__node.composite = true;
    (realMod as any).__node.members = [nodeA, nodeB];

    await expect((realMod as any).start()).rejects.toThrowError(
      /Circular dependency detected at module "circA"/
    );
  });
});

describe("Named module", () => {
  it("boots and ctx is keyed by name", async () => {
    const { ctx, stop } = await moduleA.start();
    expect(ctx.moduleA.value).toBe("module:A");
    await stop();
  });

  it("receives dependencies' ctx in boot()", async () => {
    const { ctx, stop } = await moduleB.start();
    expect(ctx.moduleA.value).toBe("module:A");
    expect(ctx.moduleB.value).toBe("module:B");
    expect(ctx.moduleB.echo?.()).toBe("module:A");
    await stop();
  });

  it("boots with full transitive dep graph", async () => {
    const { ctx, stop } = await moduleC.start();
    // expect(ctx.moduleA.value).toBe("module:A");
    expect(ctx.moduleB.value).toBe("module:B");
    expect(ctx.moduleC.value).toBe("module:C sees module:B");
    await stop();
  });
});

describe("Anonymous module", () => {
  it("merges slice flat into ctx", async () => {
    const { ctx, stop } = await anonMod.start();
    expect(ctx.anonValue).toBe("i am anon");
    await stop();
  });

  it("receives dep ctx and merges flat", async () => {
    const { ctx, stop } = await anonWithDeps.start();
    expect(ctx.moduleA.value).toBe("module:A");
    expect(ctx.derivedValue).toBe("derived from module:A");
    await stop();
  });
});

describe(".with() composition", () => {
  it("groups two modules, ctx contains both slices", async () => {
    const group = moduleA.with(moduleB);
    const { ctx, stop } = await group.start();
    expect(ctx.moduleA.value).toBe("module:A");
    expect(ctx.moduleB.value).toBe("module:B");
    await stop();
  });

  it("works with a transitive chain", async () => {
    const group = moduleA.with(moduleB, moduleC);
    const { ctx, stop } = await group.start();
    expect(ctx.moduleC.value).toBe("module:C sees module:B");
    await stop();
  });

  it("does not boot shared deps more than once", async () => {
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

    const group = left.with(right);
    const { stop } = await group.start();

    expect(bootCount).toBe(1);
    await stop();
  });
});

describe("Shutdown", () => {
  it("runs in reverse boot order", async () => {
    const order: string[] = [];

    const sA = defineModule({ name: "sA" }).init(() => ({ v: "A" }), {
      shutdown: () => {
        order.push("sA");
      },
    });
    const sB = defineModule({ name: "sB", modules: [sA] }).init(
      () => ({ v: "B" }),
      {
        shutdown: () => {
          order.push("sB");
        },
      }
    );
    const sC = defineModule({ name: "sC", modules: [sB] }).init(
      () => ({ v: "C" }),
      {
        shutdown: () => {
          order.push("sC");
        },
      }
    );

    const { stop } = await sC.start();
    await stop();

    expect(order).toEqual(["sC", "sB", "sA"]);
  });
});

describe("stop() with typed reason", () => {
  it("passes reason to module shutdown hooks", async () => {
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

  it("passes reason to global beforeShutdown / afterShutdown", async () => {
    const reasons: (string | undefined)[] = [];

    const m = defineModule({ name: "r2" }).init(() => ({}));
    const { stop } = await m.start<string>({
      beforeShutdown: (_ctx, r) => {
        reasons.push(r);
      },
      afterShutdown: (_ctx, r) => {
        reasons.push(r);
      },
    });
    await stop("SIGINT");

    expect(reasons).toEqual(["SIGINT", "SIGINT"]);
  });
});

describe("start() hooks", () => {
  it("fire in correct order with correct ctx shape", async () => {
    const log: string[] = [];

    const m = defineModule({ name: "hookMod" }).init(() => ({ v: 42 }), {
      beforeBoot: () => {
        log.push("mod:beforeBoot");
      },
      afterBoot: (ctx) => {
        log.push(`mod:afterBoot:v=${ctx.hookMod.v}`);
      },
      beforeShutdown: (ctx) => {
        log.push(`mod:beforeShutdown:v=${ctx.hookMod.v}`);
      },
      afterShutdown: (ctx) => {
        log.push(`mod:afterShutdown:v=${ctx.hookMod.v}`);
      },
    });

    const { stop } = await m.start({
      beforeBoot: () => {
        log.push("global:beforeBoot");
      },
      afterBoot: (ctx) => {
        log.push(`global:afterBoot:v=${ctx.hookMod.v}`);
      },
      beforeEachBoot: (_ctx, mod) => {
        log.push(`global:beforeEach:${mod.name}`);
      },
      afterEachBoot: (_ctx, mod) => {
        log.push(`global:afterEach:${mod.name}`);
      },
      beforeShutdown: (ctx) => {
        log.push(`global:beforeShutdown:v=${ctx.hookMod.v}`);
      },
      afterShutdown: (ctx) => {
        log.push(`global:afterShutdown:v=${ctx.hookMod.v}`);
      },
      beforeEachShutdown: (_ctx, mod) => {
        log.push(`global:beforeEachShutdown:${mod.name}`);
      },
      afterEachShutdown: (_ctx, mod) => {
        log.push(`global:afterEachShutdown:${mod.name}`);
      },
    });
    await stop();

    expect(log).toEqual([
      "global:beforeBoot",
      "global:beforeEach:hookMod",
      "mod:beforeBoot",
      // boot() runs here
      "mod:afterBoot:v=42",
      "global:afterEach:hookMod",
      "global:afterBoot:v=42",
      "global:beforeShutdown:v=42",
      "global:beforeEachShutdown:hookMod",
      "mod:beforeShutdown:v=42",
      // shutdown() runs here
      "mod:afterShutdown:v=42",
      "global:afterEachShutdown:hookMod",
      "global:afterShutdown:v=42",
    ]);
  });
});

describe("Circular dependency guard", () => {
  it("throws at runtime with clear message", async () => {
    /** Manually wire up circular nodes, bypassing type system */
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

    // Inject cycle into a real module handle to test the sort internally
    (realMod as any).__node.composite = true;
    (realMod as any).__node.members = [nodeA, nodeB];

    await expect((realMod as any).start()).rejects.toThrowError(
      /Circular dependency detected at module "circA"/
    );
  });
});
