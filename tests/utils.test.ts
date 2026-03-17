import { describe, it, expect, vi } from "vitest";
import { resolveModules, topoSort, rollback, type Module } from "../src";

/** Minimal AnyModule factory for tests. */
function mod(name: string, modules: Module<any>[] = []) {
  return { name, modules };
}

describe("resolveModules", () => {
  it("resolves a single root with no deps", () => {
    const a = mod("a");
    const result = resolveModules([a]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("a");
  });

  it("deduplicates shared dependencies", () => {
    const shared = mod("shared");
    const a = mod("a", [shared]);
    const b = mod("b", [shared]);
    const result = resolveModules([a, b]);
    const names = result.map((m) => m.name);
    expect(names.filter((n) => n === "shared")).toHaveLength(1);
    expect(names).toHaveLength(3);
  });

  it("throws on same name, different instance", () => {
    const a1 = mod("a");
    const a2 = mod("a");
    expect(() => resolveModules([a1, a2])).toThrow(
      'Module name collision: "a"'
    );
  });

  it("does not throw when same instance appears twice in roots", () => {
    const a = mod("a");
    expect(() => resolveModules([a, a])).not.toThrow();
  });

  it("resolves deep transitive dependencies", () => {
    const c = mod("c");
    const b = mod("b", [c]);
    const a = mod("a", [b]);
    const result = resolveModules([a]);
    expect(result.map((m) => m.name)).toEqual(["c", "b", "a"]);
  });

  it("returns empty array for empty roots", () => {
    expect(resolveModules([])).toEqual([]);
  });
});

describe("topoSort", () => {
  it("places dependencies before dependents", () => {
    const c = mod("c");
    const b = mod("b", [c]);
    const a = mod("a", [b]);
    const registry = new Map([
      ["a", a],
      ["b", b],
      ["c", c],
    ]);
    const result = topoSort(registry);
    const names = result.map((m) => m.name);
    expect(names.indexOf("c")).toBeLessThan(names.indexOf("b"));
    expect(names.indexOf("b")).toBeLessThan(names.indexOf("a"));
  });

  it("throws on direct circular dependency", () => {
    const a: ReturnType<typeof mod> = { name: "a", modules: [] };
    const b: ReturnType<typeof mod> = { name: "b", modules: [a] };
    a.modules.push(b); // a → b → a
    const registry = new Map([
      ["a", a],
      ["b", b],
    ]);
    expect(() => topoSort(registry)).toThrow("Circular dependency");
  });

  it("throws on indirect circular dependency", () => {
    const a: ReturnType<typeof mod> = { name: "a", modules: [] };
    const b: ReturnType<typeof mod> = { name: "b", modules: [a] };
    const c: ReturnType<typeof mod> = { name: "c", modules: [b] };
    a.modules.push(c); // a → c → b → a
    const registry = new Map([
      ["a", a],
      ["b", b],
      ["c", c],
    ]);
    expect(() => topoSort(registry)).toThrow("Circular dependency");
  });

  it("handles diamond dependency without duplication", () => {
    const d = mod("d");
    const b = mod("b", [d]);
    const c = mod("c", [d]);
    const a = mod("a", [b, c]);
    const registry = new Map([
      ["a", a],
      ["b", b],
      ["c", c],
      ["d", d],
    ]);
    const result = topoSort(registry);
    expect(result.filter((m) => m.name === "d")).toHaveLength(1);
    const names = result.map((m) => m.name);
    expect(names.indexOf("d")).toBeLessThan(names.indexOf("a"));
  });

  it("returns empty array for empty registry", () => {
    expect(topoSort(new Map())).toEqual([]);
  });

  it("skips dep names not present in registry", () => {
    // mod 'a' references 'ghost' which is not in registry — impl silently skips it
    const ghost = mod("ghost");
    const a = mod("a", [ghost]);
    const registry = new Map([["a", a]]); // ghost not registered
    expect(() => topoSort(registry)).not.toThrow();
    expect(topoSort(registry).map((m) => m.name)).toEqual(["a"]);
  });
});

describe("rollback", () => {
  /** Returns a structured log function + captured entries for assertions. */
  function makeLog() {
    const entries: unknown[][] = [];
    const log = (...args: unknown[]) => entries.push(args);
    return { log, entries };
  }

  it("shuts down modules in reverse order", async () => {
    const order: string[] = [];
    const booted = [
      {
        name: "a",
        shutdown: async () => {
          order.push("a");
        },
      },
      {
        name: "b",
        shutdown: async () => {
          order.push("b");
        },
      },
      {
        name: "c",
        shutdown: async () => {
          order.push("c");
        },
      },
    ];
    const { log } = makeLog();
    await rollback(booted, {} as any, log);
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("calls beforeShutdown, shutdown, afterShutdown in sequence", async () => {
    const calls: string[] = [];
    const m = {
      name: "x",
      beforeShutdown: async () => {
        calls.push("before");
      },
      shutdown: async () => {
        calls.push("shutdown");
      },
      afterShutdown: async () => {
        calls.push("after");
      },
    };
    const { log } = makeLog();
    await rollback([m], {} as any, log);
    expect(calls).toEqual(["before", "shutdown", "after"]);
  });

  it("logs info on successful shutdown", async () => {
    const { log, entries } = makeLog();
    await rollback([{ name: "a" }], {} as any, log);
    expect(entries).toContainEqual(["info", "a", "rollback_shutdown"]);
  });

  it("does not throw when a module shutdown throws", async () => {
    const { log } = makeLog();
    const bad = {
      name: "bad",
      shutdown: async () => {
        throw new Error("boom");
      },
    };
    await expect(rollback([bad], {} as any, log)).resolves.not.toThrow();
  });

  it("logs error on failed shutdown and continues remaining modules", async () => {
    const { log, entries } = makeLog();
    const completed: string[] = [];
    const booted = [
      {
        name: "good",
        shutdown: async () => {
          completed.push("good");
        },
      },
      {
        name: "bad",
        shutdown: async () => {
          throw new Error("fail");
        },
      },
    ];
    await rollback(booted, {} as any, log);
    expect(entries.some((e) => e[0] === "error" && e[1] === "bad")).toBe(true);
    expect(completed).toContain("good"); // continues after bad module fails
  });

  it("works with modules that have no lifecycle hooks", async () => {
    const { log, entries } = makeLog();
    await rollback([{ name: "bare" }], {} as any, log);
    expect(entries).toContainEqual(["info", "bare", "rollback_shutdown"]);
  });

  it("passes modWriter to each lifecycle hook", async () => {
    const writer = { set: vi.fn() };
    const received: [string, unknown][] = [];
    const m = {
      name: "w",
      beforeShutdown: async (w: unknown) => {
        received.push(["before", w]);
      },
      shutdown: async (w: unknown) => {
        received.push(["shutdown", w]);
      },
      afterShutdown: async (w: unknown) => {
        received.push(["after", w]);
      },
    };
    const { log } = makeLog();
    await rollback([m], writer, log);
    expect(received.every(([, w]) => w === writer)).toBe(true);
  });

  it("does not mutate the original booted array", async () => {
    const { log } = makeLog();
    const booted = [{ name: "a" }, { name: "b" }];
    const original = [...booted];
    await rollback(booted, {} as any, log);
    expect(booted).toEqual(original);
  });
});
