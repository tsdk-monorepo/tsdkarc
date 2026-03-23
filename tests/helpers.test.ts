import { describe, it, expect, vi } from "vitest";
import { defineUnit, start, type AnyModule } from "../src";
import {
  mergeUnits,
  optional,
  lazy,
  mock,
  pipe,
  type HasKey,
  type OverlapsWith,
  type AssertNoOverlap,
  checkConflicts,
} from "../src";

async function boot<const M extends readonly AnyModule[]>(roots: M) {
  return start(roots);
}

// ─── mergeUnits ───────────────────────────────────────────────────────────────

describe("mergeUnits", () => {
  it("merges contexts", async () => {
    const a = defineUnit()({ name: "a", boot: () => ({ a: 1 }) });
    const b = defineUnit()({ name: "b", boot: () => ({ b: 2 }) });
    const { ctx } = await boot([mergeUnits("ab", [a, b])]);
    expect(ctx.a).toBe(1);
    expect(ctx.b).toBe(2);
  });

  it("sets name", () => {
    const a = defineUnit()({ name: "ma", boot: () => ({ ma: 1 }) });
    const b = defineUnit()({ name: "mb", boot: () => ({ mb: 2 }) });
    expect(mergeUnits("myMerged", [a, b]).name).toBe("myMerged");
  });
});

// ─── optional ────────────────────────────────────────────────────────────────

describe("optional", () => {
  it("boots when no error", async () => {
    const a = defineUnit()({ name: "oa", boot: () => ({ oa: 1 }) });
    const { ctx } = await boot([optional(a)]);
    expect(ctx.oa).toBe(1);
  });

  it("swallows boot error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = defineUnit()({
      name: "oFail",
      boot: () => {
        throw new Error("fail");
      },
    });
    await expect(boot([optional(a)])).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("preserves name", () => {
    const a = defineUnit()({ name: "oName", boot: () => ({}) });
    expect(optional(a).name).toBe("oName");
  });
});

// ─── lazy ─────────────────────────────────────────────────────────────────────

describe("lazy", () => {
  it("defers load until boot", async () => {
    const load = vi
      .fn()
      .mockResolvedValue(
        defineUnit()({ name: "lazyInner", boot: () => ({ lazyVal: 99 }) })
      );
    const mod = lazy("lazyMod", load);
    expect(load).not.toHaveBeenCalled();
    await boot([mod]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("preserves name", () => {
    expect(
      lazy("myLazy", async () => defineUnit()({ name: "i", boot: () => ({}) }))
        .name
    ).toBe("myLazy");
  });

  it("shutdown delegates to resolved module", async () => {
    const shutdownFn = vi.fn();
    const inner = defineUnit()({
      name: "lazyShutdown",
      boot: () => ({ v: 1 }),
      shutdown: () => {
        shutdownFn();
      },
    });
    const { stop } = await boot([lazy("lazyShutdownMod", async () => inner)]);
    await stop();
    expect(shutdownFn).toHaveBeenCalledOnce();
  });
});

// ─── mock ─────────────────────────────────────────────────────────────────────

describe("mock", () => {
  it("replaces boot with mock slice", async () => {
    const db = defineUnit()({
      name: "mockDb",
      boot: () => ({ db: { find: (): string => "real" } }),
    });
    const { ctx } = await boot([mock(db, { db: { find: () => "mocked" } })]);
    expect(ctx.db.find()).toBe("mocked");
  });

  it("preserves name", () => {
    const db = defineUnit()({ name: "mockDb2", boot: () => ({ db2: 1 }) });
    expect(mock(db, { db2: 999 }).name).toBe("mockDb2");
  });

  it("clears lifecycle hooks", () => {
    const db = defineUnit()({
      name: "mockDb3",
      boot: () => ({ db3: 1 }),
      shutdown: () => {
        throw new Error("should not run");
      },
    });
    expect(mock(db, { db3: 1 }).shutdown).toBeUndefined();
  });

  it("type: rejects wrong slice shape", () => {
    const db = defineUnit()({
      name: "tMockDb",
      boot: () => ({ tDb: { find: (id: string): string => id } }),
    });
    // @ts-expect-error — wrong slice shape
    mock(db, { tDb: { wrong: true } });
  });
});

// ─── pipe ─────────────────────────────────────────────────────────────────────

describe("pipe", () => {
  it("merges all units", async () => {
    const a = defineUnit()({ name: "pa", boot: () => ({ pa: 1 }) });
    const b = defineUnit()({ name: "pb", boot: () => ({ pb: 2 }) });
    const c = defineUnit()({ name: "pc", boot: () => ({ pc: 3 }) });
    const { ctx } = await boot([pipe(a, b, c)]);
    expect(ctx.pa).toBe(1);
    expect(ctx.pb).toBe(2);
    expect(ctx.pc).toBe(3);
  });

  it("name derived from unit names", () => {
    const a = defineUnit()({ name: "na", boot: () => ({}) });
    const b = defineUnit()({ name: "nb", boot: () => ({}) });
    expect(pipe(a, b).name).toBe("pipe__na_nb");
  });
});

// ─── type helpers ─────────────────────────────────────────────────────────────

describe("type helpers", () => {
  it("HasKey", () => {
    type Ctx = { db: string };
    const _t: HasKey<Ctx, "db"> = true;
    const _f: HasKey<Ctx, "stripe"> = false;
  });

  it("OverlapsWith — never when no overlap", () => {
    const a = defineUnit()({ name: "ovA", boot: () => ({ ovA: 1 }) });
    const b = defineUnit()({ name: "ovB", boot: () => ({ ovB: 2 }) });
    const _ok: OverlapsWith<typeof a, typeof b> extends never ? true : false =
      true;
  });

  it("OverlapsWith — returns conflicting key", () => {
    const a = defineUnit()({ name: "ovC", boot: () => ({ shared: 1 }) });
    const b = defineUnit()({ name: "ovD", boot: () => ({ shared: 2 }) });
    const _ok: OverlapsWith<typeof a, typeof b> extends "shared"
      ? true
      : false = true;
  });

  it("AssertNoOverlap — true when no conflict", () => {
    const a = defineUnit()({ name: "anA", boot: () => ({ anA: 1 }) });
    const b = defineUnit()({ name: "anB", boot: () => ({ anB: 2 }) });
    const _ok: AssertNoOverlap<typeof a, typeof b> = true;
  });

  it("AssertNoOverlap — error string when conflict", () => {
    const a = defineUnit()({ name: "anC", boot: () => ({ conflict: 1 }) });
    const b = defineUnit()({ name: "anD", boot: () => ({ conflict: 2 }) });
    // @ts-expect-error
    checkConflicts([a, b]);
    // @ts-expect-error
    start(checkConflicts([a, b]));
    const _ok: AssertNoOverlap<typeof a, typeof b> extends string
      ? true
      : false = true;
  });
});
