/**
 * Watcher debounce tests.
 * Tests the debounce logic in isolation — without actual fs.watch —
 * to verify:
 *   - Rapid changes within 80ms window trigger exactly one build
 *   - Changes separated by >80ms trigger separate builds
 *   - A change during an active build queues exactly one follow-up build
 *
 * We extract the debounce+queue logic into a testable function.
 */

import { describe, test, expect } from "bun:test";

const DEBOUNCE_MS = 80;

/**
 * Testable debounce + pending-build scheduler.
 * Mirrors the logic in watcher.ts without touching the filesystem.
 *
 * Input:  buildFn — async function called when build should run
 * Output: { schedule, getCallCount }
 */
function makeScheduler(buildFn: () => Promise<void>) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let pendingBuild = false;
  let callCount = 0;

  async function runBuild() {
    building = true;
    callCount++;
    await buildFn();
    building = false;

    if (pendingBuild) {
      pendingBuild = false;
      await runBuild();
    }
  }

  function schedule() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      if (building) {
        pendingBuild = true;
        return;
      }
      await runBuild();
    }, DEBOUNCE_MS);
  }

  return {
    schedule,
    getCallCount: () => callCount,
    isBuilding: () => building,
  };
}

/** Wait for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("debounce: rapid saves batch into one build", () => {
  test("5 changes within 80ms → exactly 1 build", async () => {
    let buildCount = 0;
    const scheduler = makeScheduler(async () => {
      buildCount++;
      await sleep(10); // simulate fast build
    });

    // Fire 5 rapid changes
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    // Wait for debounce + build to complete
    await sleep(DEBOUNCE_MS + 50);

    expect(buildCount).toBe(1);
  });

  test("2 changes separated by >80ms → 2 builds", async () => {
    let buildCount = 0;
    const scheduler = makeScheduler(async () => {
      buildCount++;
      await sleep(5);
    });

    scheduler.schedule();
    await sleep(DEBOUNCE_MS + 20); // wait for first debounce to fire

    scheduler.schedule();
    await sleep(DEBOUNCE_MS + 20); // wait for second

    expect(buildCount).toBe(2);
  });
});

describe("debounce: change during active build", () => {
  test("change during build → exactly one follow-up build (not two)", async () => {
    let buildCount = 0;
    const scheduler = makeScheduler(async () => {
      buildCount++;
      await sleep(100); // slow build
    });

    // Start first build
    scheduler.schedule();
    await sleep(DEBOUNCE_MS + 10); // debounce fires, build starts

    // Fire 3 changes while build is running
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    // Wait for initial build + follow-up build to complete
    await sleep(300);

    expect(buildCount).toBe(2); // initial + exactly one follow-up
  });

  test("no change during build → no follow-up build", async () => {
    let buildCount = 0;
    const scheduler = makeScheduler(async () => {
      buildCount++;
      await sleep(50);
    });

    scheduler.schedule();
    await sleep(DEBOUNCE_MS + 150); // wait for build to finish

    expect(buildCount).toBe(1);
  });
});

describe("debounce: edge cases", () => {
  test("scheduling immediately after previous build completes triggers new build", async () => {
    let buildCount = 0;
    const scheduler = makeScheduler(async () => {
      buildCount++;
      await sleep(10);
    });

    scheduler.schedule();
    await sleep(DEBOUNCE_MS + 30);

    scheduler.schedule();
    await sleep(DEBOUNCE_MS + 30);

    expect(buildCount).toBe(2);
  });

  test("zero-duration build + rapid changes still only trigger one follow-up", async () => {
    let buildCount = 0;
    const scheduler = makeScheduler(async () => {
      buildCount++;
      await sleep(0); // instant build
    });

    scheduler.schedule();
    await sleep(DEBOUNCE_MS + 5);

    // Fire 10 rapid changes after first build
    for (let i = 0; i < 10; i++) {
      scheduler.schedule();
    }

    await sleep(DEBOUNCE_MS + 50);
    expect(buildCount).toBe(2);
  });
});
