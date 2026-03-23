import { describe, it, expect, vi } from "vitest";
import { defineUnit, AnyModule, AssertNoOverlap, OverlapsWith } from "../src";
import _start from "../src";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Boot all modules and return merged ctx. */
async function boot<const M extends readonly AnyModule[]>(roots: M) {
  const { ctx, stop } = await _start(roots);
  return { ctx, stop };
}

// ─── defineUnit() — no deps ─────────────────────────────────────────────────

describe("defineUnit() — no deps", () => {
  it("boots and returns slice", async () => {
    const mod = defineUnit()({
      name: "config",
      boot: () => ({ config: { url: "postgres://localhost" } }),
    });

    const { ctx } = await boot([mod]);
    expect(ctx.config.url).toBe("postgres://localhost");
  });

  it("void boot — no slice, no error", async () => {
    const spy = vi.fn();
    const mod = defineUnit()({
      name: "logger",
      boot: () => {
        spy();
      },
    });

    await boot([mod]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("lifecycle hooks fire in order", async () => {
    const order: string[] = [];
    const mod = defineUnit()({
      name: "lifecycle",
      beforeBoot: () => {
        order.push("beforeBoot");
      },
      boot: () => {
        order.push("boot");
        return { x: 1 };
      },
      afterBoot: () => {
        order.push("afterBoot");
      },
      beforeShutdown: () => {
        order.push("beforeShutdown");
      },
      shutdown: () => {
        order.push("shutdown");
      },
      afterShutdown: () => {
        order.push("afterShutdown");
      },
    });

    const { stop } = await boot([mod]);
    await stop();

    expect(order).toEqual([
      "beforeBoot",
      "boot",
      "afterBoot",
      "beforeShutdown",
      "shutdown",
      "afterShutdown",
    ]);
  });
});

// ─── defineUnit({ modules }) — with deps ────────────────────────────────────

describe("defineUnit({ modules }) — with deps", () => {
  it("ctx contains dep slice — no as const needed", async () => {
    const configModule = defineUnit()({
      name: "config",
      boot: () => ({ config: { url: "postgres://localhost" } }),
    });

    const dbModule = defineUnit({ modules: [configModule] })({
      name: "db",
      boot: (ctx) => ({ db: { url: ctx.config.url } }),
    });

    const { ctx } = await boot([dbModule]);
    expect(ctx.config.url).toBe("postgres://localhost");
    expect(ctx.db.url).toBe("postgres://localhost");
  });

  it("multiple deps — all slices merged", async () => {
    const modA = defineUnit()({ name: "modA", boot: () => ({ a: 1 }) });
    const modB = defineUnit()({ name: "modB", boot: () => ({ b: 2 }) });

    const modC = defineUnit({ modules: [modA, modB] })({
      name: "modC",
      boot: (ctx) => ({ c: ctx.a + ctx.b }),
    });

    const { ctx } = await boot([modC]);
    expect(ctx.a).toBe(1);
    expect(ctx.b).toBe(2);
    expect(ctx.c).toBe(3);
  });

  it("transitive deps — propagate through chain", async () => {
    const modA = defineUnit()({ name: "modA", boot: () => ({ a: "hello" }) });
    const modB = defineUnit({ modules: [modA] })({
      name: "modB",
      boot: (ctx) => ({ b: `${ctx.a} world` }),
    });
    const modC = defineUnit({ modules: [modB] })({
      name: "modC",
      boot: (ctx) => ({ c: ctx.b.toUpperCase() }),
    });

    const { ctx } = await boot([modC]);
    expect(ctx.a).toBe("hello");
    expect(ctx.b).toBe("hello world");
    expect(ctx.c).toBe("HELLO WORLD");
  });

  it("dep ctx available in shutdown", async () => {
    const configModule = defineUnit()({
      name: "config",
      boot: () => ({ config: { url: "postgres://localhost" } }),
    });

    const shutdownUrl = vi.fn();
    const dbModule = defineUnit({ modules: [configModule] })({
      name: "db",
      boot: (ctx) => ({ db: { url: ctx.config.url } }),
      shutdown: (ctx) => {
        shutdownUrl(ctx.db.url);
      },
    });

    const { stop } = await boot([dbModule]);
    await stop();

    expect(shutdownUrl).toHaveBeenCalledWith("postgres://localhost");
  });
});

describe("defineUnit .add() key conflict", () => {
  it("runtime: last-write-wins — modB overwrites modA's a", async () => {
    const modA = defineUnit()({ name: "conflictA", boot: () => ({ a: 1 }) });
    const modB = defineUnit()({
      name: "conflictB",
      boot: () => ({ a: 3, b: 2 }),
    });

    const extended = modA.add([modB]);
    const { ctx } = await boot([extended]);

    // modB boots after modA — overwrites a
    expect(ctx.a).toBe(3);
    expect(ctx.b).toBe(2);
  });

  it("type: OverlapsWith detects the conflict", () => {
    const modA = defineUnit()({
      name: "typeConflictA",
      boot: () => ({ a: 1 }),
    });
    const modB = defineUnit()({
      name: "typeConflictB",
      boot: () => ({ a: 3, b: 2 }),
    });

    // OverlapsWith catches "a" as conflicting key
    const _ok: OverlapsWith<typeof modA, typeof modB> extends "a"
      ? true
      : false = true;

    // AssertNoOverlap produces an error string
    const _err: AssertNoOverlap<typeof modA, typeof modB> extends string
      ? true
      : false = true;
  });
});

// ─── .add() composition ───────────────────────────────────────────────────────

describe(".add()", () => {
  it("merges extra module into context", async () => {
    const modA = defineUnit()({ name: "modA", boot: () => ({ a: 1 }) });
    const modB = defineUnit()({ name: "modB", boot: () => ({ b: 2 }) });

    const extended = modA.add([modB]);
    const { ctx } = await boot([extended]);

    expect(ctx.a).toBe(1);
    expect(ctx.b).toBe(2);
  });

  it("chained .add() — all modules merged", async () => {
    const modA = defineUnit()({ name: "modA", boot: () => ({ a: 1 }) });
    const modB = defineUnit()({ name: "modB", boot: () => ({ b: 2 }) });
    const modC = defineUnit()({ name: "modC", boot: () => ({ c: 3 }) });

    const { ctx } = await boot([modA.add([modB]).add([modC])]);

    expect(ctx.a).toBe(1);
    expect(ctx.b).toBe(2);
    expect(ctx.c).toBe(3);
  });

  it(".add() does not mutate original module", async () => {
    const modA = defineUnit()({ name: "modA", boot: () => ({ a: 1 }) });
    const modB = defineUnit()({ name: "modB", boot: () => ({ b: 2 }) });

    modA.add([modB]);

    const { ctx } = await boot([modA]);
    expect(ctx.a).toBe(1);
    expect((ctx as any).b).toBeUndefined();
  });

  it(".add() on module with deps — both dep and extra slices available", async () => {
    const configModule = defineUnit()({
      name: "config",
      boot: () => ({ config: { url: "postgres://localhost" } }),
    });

    const dbModule = defineUnit({ modules: [configModule] })({
      name: "db",
      boot: (ctx) => ({ db: { url: ctx.config.url } }),
    });

    const cacheModule = defineUnit()({
      name: "cache",
      boot: () => ({ cache: { get: (k: string) => k } }),
    });

    const extended = dbModule.add([cacheModule]);
    const { ctx } = await boot([extended]);

    expect(ctx.config.url).toBe("postgres://localhost");
    expect(ctx.db.url).toBe("postgres://localhost");
    expect(ctx.cache.get("key")).toBe("key");
  });
});
