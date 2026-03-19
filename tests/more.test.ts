/**
 * tsdkarc unit tests
 *
 * Covers three risk areas identified in the library review:
 *   1. Circular dependencies  — resolveModules / topoSort detection
 *   2. Async error propagation — boot failures, rollback, onError semantics
 *   3. Large graphs            — deduplication, boot order, shutdown order
 *
 * Uses the exported internal helpers (resolveModules, topoSort, rollback)
 * alongside the public API (defineModule, start) to test both layers.
 */

import { describe, it, expect, vi } from "vitest";
import start, {
  defineModule,
  resolveModules,
  topoSort,
  rollback,
} from "../src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a no-op module that records boot/shutdown calls into `log`. */
function makeTrackedModule(name: string, deps = [] as any[], log: any) {
  return defineModule()({
    name,
    modules: deps,
    async boot() {
      log.push(`boot:${name}`);
    },
    async shutdown() {
      log.push(`shutdown:${name}`);
    },
  });
}

// ---------------------------------------------------------------------------
// 1. Circular dependency detection
// ---------------------------------------------------------------------------

describe("circular dependency detection", () => {
  it("throws on a direct self-referential module (A → A)", () => {
    // Construct the cycle manually since defineModule prevents it at the type
    // level — we need to mutate after creation.
    const modA: any = defineModule()({ name: "A", modules: [] });
    modA.modules = [modA];

    expect(() => resolveModules([modA])).toThrow(
      /Circular dependency detected at: "A"/
    );
  });

  it("throws on a two-node cycle (A → B → A)", () => {
    const modA: any = defineModule()({ name: "A", modules: [] });
    const modB = defineModule()({ name: "B", modules: [modA] });
    modA.modules = [modB]; // close the cycle

    expect(() => resolveModules([modA])).toThrow(/Circular dependency/);
  });

  it("throws on a three-node cycle (A → B → C → A)", () => {
    const modA: any = defineModule()({ name: "A", modules: [] });
    const modB = defineModule()({ name: "B", modules: [modA] });
    const modC = defineModule()({ name: "C", modules: [modB] });
    modA.modules = [modC]; // close the cycle

    expect(() => resolveModules([modA])).toThrow(/Circular dependency/);
  });

  it("throws on name collision (same name, different instances)", () => {
    const modA1 = defineModule()({ name: "shared", modules: [] });
    const modA2 = defineModule()({ name: "shared", modules: [] });
    const modB = defineModule()({ name: "B", modules: [modA1] });
    const modC = defineModule()({ name: "C", modules: [modA2] });

    expect(() => resolveModules([modB, modC])).toThrow(
      /Module name collision: "shared"/
    );
  });

  it("does NOT throw when the same instance appears via multiple paths (diamond)", () => {
    // A is a shared dep of both B and C; root is D.
    // This is valid — same instance, not a cycle.
    const modA: any = defineModule()({ name: "A", modules: [] });
    const modB = defineModule()({ name: "B", modules: [modA] });
    const modC = defineModule()({ name: "C", modules: [modA] });
    const modD = defineModule()({ name: "D", modules: [modB, modC] });

    expect(() => resolveModules([modD])).not.toThrow();
  });

  it("topoSort throws when a name is in-stack (direct cycle via registry)", () => {
    // Build a registry manually with a cycle already embedded.
    const modA: any = defineModule()({ name: "A", modules: [] });
    const modB = defineModule()({ name: "B", modules: [modA] });
    modA.modules = [modB];

    const registry = new Map([
      ["A", modA],
      ["B", modB],
    ]);

    expect(() => topoSort(registry)).toThrow(/Circular dependency/);
  });
});

// ---------------------------------------------------------------------------
// 2. Async error propagation
// ---------------------------------------------------------------------------

describe("async error propagation", () => {
  it("throws (wraps) when boot() rejects and no onError is provided", async () => {
    const badModule = defineModule()({
      name: "bad",
      modules: [],
      async boot() {
        throw new Error("boom");
      },
    });

    await expect(start([badModule])).rejects.toThrow(
      /Module "bad" boot failed: boom/
    );
  });

  it("calls onError instead of throwing when onError is provided", async () => {
    const errors: any[] = [];
    const badModule = defineModule()({
      name: "bad",
      modules: [],
      async boot() {
        throw new Error("soft-fail");
      },
    });

    // Should not throw — onError absorbs it
    await expect(
      start([badModule], {
        onError(err) {
          errors.push(err.message);
        },
      })
    ).resolves.not.toThrow();

    expect(errors).toEqual(['Module "bad" boot failed: soft-fail']);
  });

  it("rolls back already-booted modules when a later boot() fails", async () => {
    const log: any[] = [];

    const modA: any = makeTrackedModule("A", [], log);
    const modB = defineModule()({
      name: "B",
      modules: [modA],
      async boot() {
        log.push("boot:B");
        throw new Error("B exploded");
      },
      async shutdown() {
        log.push("shutdown:B");
      },
    });

    await expect(start([modB])).rejects.toThrow(/Module "B" boot failed/);

    // A booted successfully and must be rolled back; B never completed boot
    expect(log).toEqual(["boot:A", "boot:B", "shutdown:A"]);
  });

  it("rolls back in reverse boot order across multiple successful modules", async () => {
    const log: any[] = [];

    const modA: any = makeTrackedModule("A", [] as any[], log);
    const modB = makeTrackedModule("B", [modA], log);
    const modC = defineModule()({
      name: "C",
      modules: [modB],
      async boot() {
        log.push("boot:C");
        throw new Error("C failed");
      },
      async shutdown() {
        log.push("shutdown:C");
      },
    });

    await expect(start([modC])).rejects.toThrow(/Module "C" boot failed/);

    // Boot order: A → B → C(fail). Rollback order: B → A (C never completed).
    expect(log).toEqual([
      "boot:A",
      "boot:B",
      "boot:C",
      "shutdown:B",
      "shutdown:A",
    ]);
  });

  it("onError receives the correct module reference on failure", async () => {
    const captured: any[] = [];

    const badModule = defineModule()({
      name: "target",
      modules: [],
      async boot() {
        throw new Error("err");
      },
    });

    await start([badModule], {
      onError(err, _ctx, mod) {
        captured.push({ message: err.message, moduleName: mod.name });
      },
    });

    expect(captured).toEqual([
      { message: 'Module "target" boot failed: err', moduleName: "target" },
    ]);
  });

  it("stop() triggers shutdown errors through onError when provided", async () => {
    const shutdownErrors: any[] = [];

    const modA: any = defineModule()({
      name: "A",
      modules: [],
      async boot() {},
      async shutdown() {
        throw new Error("shutdown-boom");
      },
    });

    const app = await start([modA], {
      onError(err) {
        shutdownErrors.push(err.message);
      },
    });

    await app.stop();
    expect(shutdownErrors[0]).toMatch(/Module "A" stop failed: shutdown-boom/);
  });

  it("stop() is idempotent — calling it twice does not double-shutdown", async () => {
    const log: any[] = [];
    const modA: any = makeTrackedModule("A", [], log);

    const app = await start([modA]);
    await app.stop();
    await app.stop(); // second call should be a no-op

    expect(log.filter((e) => e === "shutdown:A")).toHaveLength(1);
  });

  it("rollback() itself throws if a shutdown hook fails during rollback", async () => {
    // rollback() is best-effort per the source: it re-throws on error.
    const badMod = defineModule()({
      name: "A",
      modules: [],
      async shutdown() {
        throw new Error("rollback-shutdown-fail");
      },
    });

    const fakeCtx = { set: () => {} };
    await expect(rollback([badMod], fakeCtx)).rejects.toThrow(
      /rollback_shutdown_failed/
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Large graphs
// ---------------------------------------------------------------------------

describe("large graphs", () => {
  /**
   * Build a linear chain: mod_0 ← mod_1 ← mod_2 ← … ← mod_n
   * Each module depends on the previous one.
   */
  function buildChain(length: any, log: any) {
    const mods = [];
    for (let i = 0; i < length; i++) {
      const deps: any = i === 0 ? [] : [mods[i - 1]];
      mods.push(makeTrackedModule(`mod_${i}`, deps, log));
    }
    return mods;
  }

  it("boots a 100-module linear chain in dependency order", async () => {
    const log: any[] = [];
    const chain = buildChain(100, log);
    const root = chain[chain.length - 1];

    const app = await start([root]);
    await app.stop();

    const bootLog = log.filter((e) => e.startsWith("boot:"));
    const shutdownLog = log.filter((e) => e.startsWith("shutdown:"));

    // Boot must be 0 → 99
    expect(bootLog[0]).toBe("boot:mod_0");
    expect(bootLog[99]).toBe("boot:mod_99");

    // Shutdown must be reverse: 99 → 0
    expect(shutdownLog[0]).toBe("shutdown:mod_99");
    expect(shutdownLog[99]).toBe("shutdown:mod_0");

    // All 100 modules booted and shut down exactly once
    expect(bootLog).toHaveLength(100);
    expect(shutdownLog).toHaveLength(100);
  });

  it("deduplicates shared deps in a diamond graph (large fan-in)", () => {
    // One shared base; N mid-tier modules each depending on it; one root.
    const base = defineModule()({ name: "base", modules: [] });

    const midTier = Array.from({ length: 50 }, (_, i) =>
      defineModule()({ name: `mid_${i}`, modules: [base] })
    );

    const root = defineModule()({ name: "root", modules: midTier });
    const resolved = resolveModules([root]);

    // base must appear exactly once despite 50 references to it
    const names = resolved.map((m) => m.name);
    expect(names.filter((n) => n === "base")).toHaveLength(1);
    expect(names).toHaveLength(52); // base + 50 mid + root
  });

  it("boots a 500-module linear chain without stack overflow", async () => {
    // Regression: deep recursion in collect() could overflow the call stack.
    const log: any[] = [];
    const chain = buildChain(500, log);
    const root = chain[chain.length - 1];

    const app = await start([root]);
    await app.stop();

    expect(log.filter((e) => e.startsWith("boot:"))).toHaveLength(500);
    expect(log.filter((e) => e.startsWith("shutdown:"))).toHaveLength(500);
  });

  it("boots all modules exactly once in a wide fan-out graph", async () => {
    // root depends on N leaves directly (no shared deps)
    const log: any[] = [];
    const leaves = Array.from({ length: 200 }, (_, i) =>
      makeTrackedModule(`leaf_${i}`, [], log)
    );
    const root = makeTrackedModule("root", leaves, log);

    const app = await start([root]);
    await app.stop();

    const bootLog = log.filter((e) => e.startsWith("boot:"));

    // Each leaf boots exactly once, root boots last
    expect(bootLog).toHaveLength(201);
    expect(bootLog[200]).toBe("boot:root");
    expect(new Set(bootLog).size).toBe(201); // no duplicates
  });

  it("resolves a complex DAG (multiple shared ancestors) in valid topo order", () => {
    //       A
    //      / \
    //     B   C
    //      \ / \
    //       D   E
    //        \ /
    //         F  (root)
    const A = defineModule()({ name: "A", modules: [] });
    const B = defineModule()({ name: "B", modules: [A] });
    const C = defineModule()({ name: "C", modules: [A] });
    const D = defineModule()({ name: "D", modules: [B, C] });
    const E = defineModule()({ name: "E", modules: [C] });
    const F = defineModule()({ name: "F", modules: [D, E] });

    const order = resolveModules([F]).map((m) => m.name);

    // Invariant: every module appears after all its dependencies
    const pos = Object.fromEntries(order.map((name, i) => [name, i]));
    expect(pos["A"]).toBeLessThan(pos["B"]);
    expect(pos["A"]).toBeLessThan(pos["C"]);
    expect(pos["B"]).toBeLessThan(pos["D"]);
    expect(pos["C"]).toBeLessThan(pos["D"]);
    expect(pos["C"]).toBeLessThan(pos["E"]);
    expect(pos["D"]).toBeLessThan(pos["F"]);
    expect(pos["E"]).toBeLessThan(pos["F"]);

    // A appears exactly once despite two paths to it
    expect(order.filter((n) => n === "A")).toHaveLength(1);
  });
});
