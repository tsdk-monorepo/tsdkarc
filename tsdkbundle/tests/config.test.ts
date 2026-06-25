import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig, ConfigValidationError } from "../src/config";

const TMP = join(import.meta.dir, "__tmp__");

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Write a JSON config fixture and return its path. */
function writeJsonConfig(name: string, data: unknown): string {
  const path = join(TMP, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

/** Write a JS module config fixture. */
function writeJsConfig(name: string, content: string): string {
  const path = join(TMP, `${name}.js`);
  writeFileSync(path, content);
  return path;
}

describe("loadConfig: valid configs & dynamic targets", () => {
  test("minimal valid backend config infers target bun", async () => {
    const path = writeJsonConfig("minimal-backend", {
      projects: {
        api: { type: "backend", entry: "src/index.ts" },
      },
    });
    const result = await loadConfig(path, "dev");
    expect(result.projects.api).toBeDefined();
    expect(result.projects.api?.type).toBe("backend");
    expect(result.projects.api?.target).toBe("bun");
    expect(result.projects.api?.plugins).toEqual([]);
  });

  test("minimal valid frontend config infers target browser", async () => {
    const path = writeJsonConfig("minimal-frontend", {
      projects: {
        web: { type: "frontend", entry: "src/index.tsx" },
      },
    });
    const result = await loadConfig(path, "dev");
    expect(result.projects.web).toBeDefined();
    expect(result.projects.web?.type).toBe("frontend");
    expect(result.projects.web?.target).toBe("browser");
  });

  test("explicit target overrides defaults", async () => {
    const path = writeJsonConfig("explicit-target", {
      projects: {
        worker: { type: "backend", target: "node", entry: "src/index.ts" },
      },
    });
    const result = await loadConfig(path, "build");
    expect(result.projects.worker?.target).toBe("node");
  });

  test("array of entries resolved correctly", async () => {
    const path = writeJsonConfig("array-entries", {
      projects: { api: { type: "backend", entry: ["src/a.ts", "src/b.ts"] } },
    });
    const result = await loadConfig(path, "dev");
    expect(result.projects.api?.entry.length).toBe(2);
    expect(result.projects.api?.entry[0]).toContain("src/a.ts");
  });
});

describe("loadConfig: dynamic function exports", () => {
  test("function config receives ctx and returns config", async () => {
    const content = `
      export default (ctx) => ({
        projects: {
          dynamic: {
            type: "backend",
            entry: "src/" + ctx.command + ".ts",
            minify: ctx.command === "build"
          }
        }
      });
    `;
    const path = writeJsConfig("dynamic-func", content);
    
    // Test context as dev
    const devResult = await loadConfig(path, "dev");
    expect(devResult.projects.dynamic?.entry[0]).toContain("src/dev.ts");
    expect(devResult.projects.dynamic?.minify).toBe(false);

    // Test context as build
    const buildResult = await loadConfig(path, "build");
    expect(buildResult.projects.dynamic?.entry[0]).toContain("src/build.ts");
    expect(buildResult.projects.dynamic?.minify).toBe(true);
  });
});

describe("loadConfig: validation errors", () => {
  test("invalid type throws", async () => {
    const path = writeJsonConfig("invalid-type", {
      projects: { api: { type: "mobile", entry: "src/index.ts" } },
    });
    const err = await loadConfig(path, "dev").catch((e) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.errors[0].field).toBe("projects.api.type");
  });

  test("missing entry throws", async () => {
    const path = writeJsonConfig("missing-entry", {
      projects: { api: { type: "backend" } },
    });
    const err = await loadConfig(path, "dev").catch((e) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.errors[0].field).toBe("projects.api.entry");
  });

  test("multiple errors are all reported", async () => {
    const path = writeJsonConfig("multi-error", {
      projects: {
        api: { entry: "src/index.ts" },          // missing type
        web: { type: "frontend" },                 // missing entry
      },
    });
    const err = await loadConfig(path, "dev").catch((e) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.errors.length).toBeGreaterThanOrEqual(2);
  });
});