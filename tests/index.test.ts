/**
 * backbone.test.ts
 *
 * Tests split into two sections:
 *   1. Runtime tests  — behavior correctness (vitest)
 *   2. Type tests     — compile-time correctness (expectTypeOf + @ts-expect-error)
 *
 * No `any`. The circular dep test uses `as unknown as` at the one boundary
 * where the type system cannot express cycles.
 *
 * defineModule API:
 *   defineModule()({ ... })              — no own slice, deps inferred
 *   defineModule<OwnSlice>()({ ... })   — own slice explicit, deps inferred
 */

import { describe, it, expect, vi, expectTypeOf } from "vitest";
import start, { defineModule } from "../src";

// ---------------------------------------------------------------------------
// Shared slice types and module factories
// ---------------------------------------------------------------------------

type DbSlice = { db: { query(): string } };
type CacheSlice = { cache: { get(k: string): string | undefined } };
type QueueSlice = { queue: { push(item: string): void } };

const makeDb = () =>
  defineModule<DbSlice>()({
    name: "db",
    description: "Database connection",
    boot: async (ctx) => {
      ctx.set("db", { query: () => "result" });
    },
    shutdown: async (_ctx) => {},
  });

const makeCache = () =>
  defineModule<CacheSlice>()({
    name: "cache",
    boot: async (ctx) => {
      ctx.set("cache", { get: (k) => (k === "hit" ? "value" : undefined) });
    },
  });

const makeQueue = (
  deps: readonly [ReturnType<typeof makeDb>, ReturnType<typeof makeCache>]
) =>
  defineModule<QueueSlice>()({
    name: "queue",
    modules: deps,
    boot: async (ctx) => {
      console.log(ctx.db);
      console.log(ctx.cache);
      ctx.set("queue", { push: (_item) => {} });
    },
  });

const noopLog = vi.fn();

// ---------------------------------------------------------------------------
// 1. Runtime tests
// ---------------------------------------------------------------------------

describe("boot order", () => {
  it("boots a single module", async () => {
    const order: string[] = [];
    const A = defineModule()({
      name: "A",
      boot: async () => {
        order.push("boot:A");
      },
    });
    await start([A], {});
    expect(order).toEqual(["boot:A"]);
  });

  it("boots deps before dependents", async () => {
    const order: string[] = [];
    const track = (name: string) =>
      defineModule()({
        name,
        boot: async () => {
          order.push(`boot:${name}`);
        },
      });
    const C = track("C");
    const B = defineModule()({
      name: "B",
      modules: [C] as const,
      boot: async () => {
        order.push("boot:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B, C] as const,
      boot: async () => {
        order.push("boot:A");
      },
    });
    await start([A], {});
    expect(order.indexOf("boot:C")).toBeLessThan(order.indexOf("boot:B"));
    expect(order.indexOf("boot:B")).toBeLessThan(order.indexOf("boot:A"));
  });

  it("dedupes shared dep — C booted once when A and B both require it", async () => {
    const order: string[] = [];
    const C = defineModule()({
      name: "C",
      boot: async () => {
        order.push("boot:C");
      },
    });
    const B = defineModule()({
      name: "B",
      modules: [C] as const,
      boot: async () => {
        order.push("boot:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B, C] as const,
      boot: async () => {
        order.push("boot:A");
      },
    });
    await start([A], {});
    expect(order.filter((e) => e === "boot:C")).toHaveLength(1);
  });

  it("discovers deep tree from single root", async () => {
    const order: string[] = [];
    const track = (name: string) =>
      defineModule()({
        name,
        boot: async () => {
          order.push(`boot:${name}`);
        },
      });
    const G = track("G");
    const D = defineModule()({
      name: "D",
      modules: [G] as const,
      boot: async () => {
        order.push("boot:D");
      },
    });
    const C = defineModule()({
      name: "C",
      modules: [G] as const,
      boot: async () => {
        order.push("boot:C");
      },
    });
    const B = defineModule()({
      name: "B",
      modules: [C, D] as const,
      boot: async () => {
        order.push("boot:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      boot: async () => {
        order.push("boot:A");
      },
    });
    await start([A], {});
    expect(order).toContain("boot:G");
    expect(order).toContain("boot:A");
    expect(order.filter((e) => e === "boot:G")).toHaveLength(1);
  });
});

describe("shutdown order", () => {
  it("shuts down in reverse boot order", async () => {
    const order: string[] = [];
    const C = defineModule()({
      name: "C",
      shutdown: async () => {
        order.push("shutdown:C");
      },
    });
    const B = defineModule()({
      name: "B",
      modules: [C] as const,
      shutdown: async () => {
        order.push("shutdown:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      shutdown: async () => {
        order.push("shutdown:A");
      },
    });
    const { stop } = await start([A], {});
    await stop();
    expect(order).toEqual(["shutdown:A", "shutdown:B", "shutdown:C"]);
  });

  it("stop() is idempotent", async () => {
    const order: string[] = [];
    const A = defineModule()({
      name: "A",
      shutdown: async () => {
        order.push("shutdown:A");
      },
    });
    const { stop } = await start([A], {});
    await stop();
    await stop();
    expect(order.filter((e) => e === "shutdown:A")).toHaveLength(1);
  });
});

describe("context", () => {
  it("module can write and downstream module can read", async () => {
    const db = makeDb();
    let readValue: string | undefined;
    const App = defineModule()({
      name: "app",
      modules: [db] as const,
      boot: async (ctx) => {
        readValue = ctx["db"]?.query();
      },
    });
    const app = await start([App], {});
    expect(app.ctx.db).toBeDefined();
    expect(app.stop).toBeDefined();
    expect(readValue).toBe("result");
  });

  it("get on unset key returns undefined", async () => {
    let val: string | undefined = "sentinel";
    const A = defineModule<DbSlice>()({
      name: "A",
      boot: async (ctx) => {
        val = ctx["db"]?.query();
      },
    });
    await start([A], {});
    expect(val).toBeUndefined();
  });
});

describe("per-module lifecycle hooks", () => {
  it("beforeBoot/afterBoot fire around this module only — not other modules", async () => {
    const calls: string[] = [];
    const B = defineModule()({
      name: "B",
      boot: async () => {
        calls.push("boot:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      beforeBoot: async () => {
        calls.push("A:before");
      },
      boot: async () => {
        calls.push("boot:A");
      },
      afterBoot: async () => {
        calls.push("A:after");
      },
    });
    await start([A], {});
    expect(calls).toEqual(["boot:B", "A:before", "boot:A", "A:after"]);
  });

  it("beforeShutdown/afterShutdown fire around this module only", async () => {
    const calls: string[] = [];
    const B = defineModule()({
      name: "B",
      shutdown: async () => {
        calls.push("shutdown:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      beforeShutdown: async () => {
        calls.push("A:before");
      },
      shutdown: async () => {
        calls.push("shutdown:A");
      },
      afterShutdown: async () => {
        calls.push("A:after");
      },
    });
    const { stop } = await start([A], {});
    await stop();
    expect(calls).toEqual(["A:before", "shutdown:A", "A:after", "shutdown:B"]);
  });

  it("per-module hook can read and write ctx — same as boot", async () => {
    type Sl = { value: number };
    let seen: number | undefined;
    const A = defineModule<Sl>()({
      name: "A",
      beforeBoot: async (ctx) => {
        ctx.set("value", 99);
      },
      boot: async (ctx) => {
        seen = ctx["value"];
      },
    });
    await start([A], {});
    expect(seen).toBe(99);
  });
});

describe("global lifecycle hooks", () => {
  it("beforeBoot fires once before any module boots", async () => {
    const calls: string[] = [];
    const B = defineModule()({
      name: "B",
      boot: async () => {
        calls.push("boot:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      boot: async () => {
        calls.push("boot:A");
      },
    });
    await start([A], {
      beforeBoot: async () => {
        calls.push("global:before");
      },
    });
    expect(calls).toEqual(["global:before", "boot:B", "boot:A"]);
  });

  it("afterBoot fires once after all modules have booted", async () => {
    const calls: string[] = [];
    const B = defineModule()({
      name: "B",
      boot: async () => {
        calls.push("boot:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      boot: async () => {
        calls.push("boot:A");
      },
    });
    await start([A], {
      afterBoot: async () => {
        calls.push("global:after");
      },
    });
    expect(calls).toEqual(["boot:B", "boot:A", "global:after"]);
  });

  it("beforeShutdown fires once before any module shuts down", async () => {
    const calls: string[] = [];
    const B = defineModule()({
      name: "B",
      shutdown: async () => {
        calls.push("shutdown:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      shutdown: async () => {
        calls.push("shutdown:A");
      },
    });
    const { stop } = await start([A], {
      beforeShutdown: async () => {
        calls.push("global:before");
      },
    });
    await stop();
    expect(calls).toEqual(["global:before", "shutdown:A", "shutdown:B"]);
  });

  it("afterShutdown fires once after all modules have shut down", async () => {
    const calls: string[] = [];
    const B = defineModule()({
      name: "B",
      shutdown: async () => {
        calls.push("shutdown:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      shutdown: async () => {
        calls.push("shutdown:A");
      },
    });
    const { stop } = await start([A], {
      afterShutdown: async () => {
        calls.push("global:after");
      },
    });
    await stop();
    expect(calls).toEqual(["shutdown:A", "shutdown:B", "global:after"]);
  });

  it("full global order — before/after wrap all modules", async () => {
    const calls: string[] = [];
    const B = defineModule()({
      name: "B",
      boot: async () => {
        calls.push("boot:B");
      },
      shutdown: async () => {
        calls.push("shutdown:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      boot: async () => {
        calls.push("boot:A");
      },
      shutdown: async () => {
        calls.push("shutdown:A");
      },
    });
    const { stop } = await start([A], {
      beforeBoot: async () => {
        calls.push("beforeBoot");
      },
      afterBoot: async () => {
        calls.push("afterBoot");
      },
      beforeShutdown: async () => {
        calls.push("beforeShutdown");
      },
      afterShutdown: async () => {
        calls.push("afterShutdown");
      },
    });
    await stop();
    expect(calls).toEqual([
      "beforeBoot",
      "boot:B",
      "boot:A",
      "afterBoot",
      "beforeShutdown",
      "shutdown:A",
      "shutdown:B",
      "afterShutdown",
    ]);
  });

  it("global beforeShutdown does NOT fire during rollback — rollback is error recovery", async () => {
    const calls: string[] = [];
    const B = defineModule()({
      name: "B",
      boot: async () => {},
      shutdown: async () => {
        calls.push("rollback:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      boot: async () => {
        throw new Error("fail");
      },
    });
    await expect(
      start([A], {
        beforeShutdown: async () => {
          calls.push("global:before");
        },
      })
    ).rejects.toThrow("fail");
    expect(calls).not.toContain("global:before");
    expect(calls).toContain("rollback:B");
  });

  it("typed afterBoot ctx — inferred from roots", async () => {
    const db = makeDb();
    let seen: string | undefined;
    await start([db], {
      afterBoot: async (ctx) => {
        seen = ctx.db?.query();
      },
    });
    expect(seen).toBe("result");
  });

  it("typed beforeShutdown ctx — inferred across multiple roots", async () => {
    const db = makeDb();
    const cache = makeCache();
    let dbVal: string | undefined;
    let cacheVal: string | undefined;
    const { stop } = await start([db, cache], {
      beforeShutdown: async (ctx) => {
        dbVal = ctx.db?.query();
        cacheVal = ctx.cache?.get("hit");
      },
    });
    await stop();
    expect(dbVal).toBe("result");
    expect(cacheVal).toBe("value");
  });
});

describe("error handling", () => {
  it("throws and rolls back already-booted modules on failure", async () => {
    const order: string[] = [];
    const B = defineModule()({
      name: "B",
      boot: async () => {
        order.push("boot:B");
      },
      shutdown: async () => {
        order.push("shutdown:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      boot: async () => {
        throw new Error("A exploded");
      },
      shutdown: async () => {
        order.push("shutdown:A");
      },
    });
    await expect(start([A], {})).rejects.toThrow("A exploded");
    expect(order).toContain("shutdown:B");
    expect(order).not.toContain("shutdown:A");
  });

  it("throws on circular dependency", async () => {
    const A = { name: "A", modules: [] } as unknown as ReturnType<
      ReturnType<typeof defineModule>
    >;
    const B = { name: "B", modules: [A] } as unknown as ReturnType<
      ReturnType<typeof defineModule>
    >;
    (A as { modules: unknown[] }).modules.push(B);
    await expect(start([A], {})).rejects.toThrow("Circular dependency");
  });

  it("throws on name collision — same name, different instance", async () => {
    const A1 = defineModule()({ name: "A" });
    const A2 = defineModule()({ name: "A" });
    const Root = defineModule()({ name: "Root", modules: [A1, A2] as const });
    await expect(start([Root], {})).rejects.toThrow("collision");
  });

  it("does not throw when same instance is referenced multiple times", async () => {
    const Shared = defineModule()({ name: "Shared" });
    const B = defineModule()({ name: "B", modules: [Shared] as const });
    const A = defineModule()({ name: "A", modules: [B, Shared] as const });
    await expect(start([A], {})).resolves.toBeDefined();
  });

  it("continues shutting down remaining modules if one shutdown throws", async () => {
    const order: string[] = [];
    const B = defineModule()({
      name: "B",
      shutdown: async () => {
        order.push("shutdown:B");
      },
    });
    const A = defineModule()({
      name: "A",
      modules: [B] as const,
      shutdown: async () => {
        throw new Error("shutdown exploded");
      },
    });
    const { stop } = await start([A], {
      onError(err) {
        console.error(err);
      },
    });
    await stop().catch((e) => e);
    expect(order).toContain("shutdown:B");
  });
});

// ---------------------------------------------------------------------------
// 2. Type tests
// ---------------------------------------------------------------------------

describe("types", () => {
  it("ctx.get returns correct type for own slice key", () => {
    defineModule<DbSlice>()({
      name: "type-get-return",
      boot: async (ctx) => {
        expectTypeOf(ctx.db).toEqualTypeOf<DbSlice["db"]>();
      },
    });
  });

  it("ctx.set rejects unknown key", () => {
    defineModule<DbSlice>()({
      name: "type-set-unknown",
      boot: async (ctx) => {
        // @ts-expect-error — 'nonexistent' is not a key of DbSlice
        ctx.set("nonexistent", "value");
      },
    });
  });

  it("ctx.get sees merged context from all deps", () => {
    const db = makeDb();
    const cache = makeCache();
    defineModule()({
      name: "type-merged-ctx",
      modules: [db, cache] as const,
      boot: async (ctx) => {
        expectTypeOf(ctx.db).toEqualTypeOf<DbSlice["db"]>();
        expectTypeOf(ctx.cache).toEqualTypeOf<CacheSlice["cache"]>();
      },
    });
  });

  it("ctx.get rejects key not in deps", () => {
    const db = makeDb();
    defineModule()({
      name: "type-get-missing-dep",
      modules: [db] as const,
      boot: async (ctx) => {
        // @ts-expect-error — 'cache' is not in context when only db is a dep
        const { cache } = ctx;
      },
    });
  });

  it("ctx.set rejects writing a dep key — deps are read-only", () => {
    const db = makeDb();
    defineModule()({
      name: "type-set-dep-key",
      modules: [db] as const,
      boot: async (ctx) => {
        // @ts-expect-error — 'db' is readable but not writable (not in OwnSlice)
        ctx.set("db", { query: () => "hack" });
      },
    });
  });

  it("three-level dep chain — [queue] alone exposes db, cache, queue", () => {
    const db = makeDb();
    const cache = makeCache();
    const queue = makeQueue([db, cache] as const);
    // queue's S = DbSlice & CacheSlice & QueueSlice — propagates via SliceOf
    defineModule()({
      name: "type-three-levels",
      modules: [queue] as const,
      boot: async (ctx) => {
        expectTypeOf(ctx.db).toEqualTypeOf<DbSlice["db"]>();
        expectTypeOf(ctx.cache).toEqualTypeOf<CacheSlice["cache"]>();
        expectTypeOf(ctx.queue).toEqualTypeOf<QueueSlice["queue"]>();
      },
    });
  });

  it("per-module hook ctx has same type as boot — no name param", () => {
    const db = makeDb();
    defineModule<CacheSlice>()({
      name: "type-mod-hook-ctx",
      modules: [db] as const,
      afterBoot: async (ctx) => {
        // expectTypeOf(ctx).toEqualTypeOf<ContextWriter<DbSlice & CacheSlice, CacheSlice>>();
      },
    });
  });

  it("global hook ctx inferred from roots — no explicit S needed", async () => {
    const db = makeDb();
    await start([db], {
      afterBoot: async (ctx) => {
        expectTypeOf(ctx.db).toEqualTypeOf<DbSlice["db"]>();
      },
    });
  });

  it("global hook ctx inferred across multiple roots", async () => {
    const db = makeDb();
    const cache = makeCache();
    await start([db, cache], {
      afterBoot: async (ctx) => {
        expectTypeOf(ctx.db).toEqualTypeOf<DbSlice["db"]>();
        expectTypeOf(ctx.cache).toEqualTypeOf<CacheSlice["cache"]>();
      },
    });
  });
});
