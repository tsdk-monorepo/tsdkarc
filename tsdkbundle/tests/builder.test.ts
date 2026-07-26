import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { ResolvedProject, BuildResult } from "../src/types";
import { buildProject } from "../src/builder";
import type { BunPlugin } from "bun";

function makeProject(
  overrides: Partial<ResolvedProject> = {}
): ResolvedProject {
  return {
    name: "api",
    target: "bun",
    entry: ["/project/src/index.ts"],
    main: "/project/dist/api/index.js",
    tsconfig: "/project/tsconfig.json",
    outdir: "/project/dist/api",
    envFile: null,
    external: [],
    sourcemap: "linked",
    minify: false,
    port: null,
    watchDirs: [],
    plugins: [], // <-- ADDED
    ignore: [],
    ...overrides,
  };
}

function mockBunBuildSuccess(
  outputs: string[] = ["/project/dist/api/index.js"]
) {
  return {
    success: true,
    outputs: outputs.map((path) => ({ path })),
    logs: [],
  };
}

function mockBunBuildFailure(errors: string[] = ["Syntax error"]) {
  return {
    success: false,
    outputs: [],
    logs: errors.map((message) => ({ level: "error", message })),
  };
}

describe("buildProject: core parameters", () => {
  let capturedOptions: any = null;
  let originalBuild: typeof Bun.build;

  beforeEach(() => {
    originalBuild = Bun.build;
    // @ts-ignore
    Bun.build = async (opts: any) => {
      capturedOptions = opts;
      return mockBunBuildSuccess();
    };
  });

  afterEach(() => {
    Bun.build = originalBuild;
    capturedOptions = null;
  });

  test("passes project properties to Bun.build correctly for backend", async () => {
    const dummyPlugin: BunPlugin = { name: "dummy", setup() {} };

    const project = makeProject({
      entry: ["/project/src/api.ts"],
      outdir: "/custom/dist",
      external: ["pg"],
      tsconfig: "/custom/tsconfig.json",
      target: "bun",
      plugins: [dummyPlugin],
    });

    await buildProject(project, "build");

    expect(capturedOptions.entrypoints).toEqual(["/project/src/api.ts"]);
    expect(capturedOptions.outdir).toBe("/custom/dist");
    expect(capturedOptions.target).toBe("bun");
    expect(capturedOptions.external).toEqual(["pg"]);
    expect(capturedOptions.tsconfig).toBe("/custom/tsconfig.json");
    expect(capturedOptions.format).toBe("esm");
    expect(capturedOptions.plugins).toEqual([dummyPlugin]); // Validate Plugins
  });


  test("omits tsconfig if not specified", async () => {
    const project = makeProject({ tsconfig: "" });
    await buildProject(project, "build");
    expect(capturedOptions.tsconfig).toBeUndefined();
  });
});

describe("buildProject: error handling", () => {
  let originalBuild: typeof Bun.build;

  afterEach(() => {
    Bun.build = originalBuild;
  });

  test("returns success=false and captures logs on build failure", async () => {
    originalBuild = Bun.build;
    // @ts-ignore
    Bun.build = async () => mockBunBuildFailure(["Module not found: ./foo"]);

    const result = await buildProject(makeProject(), "dev");
    expect(result.success).toBe(false);
    expect(result.errors).toContain("Module not found: ./foo");
    expect(result.project).toBe("api");
  });

  test("thrown exception from Bun.build is captured as error, not rethrown", async () => {
    originalBuild = Bun.build;
    // @ts-ignore
    Bun.build = async () => {
      throw new Error("Bun.build catastrophic failure");
    };

    const result = await buildProject(makeProject(), "dev");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("catastrophic failure");
  });
});

describe("buildProject: sourcemap", () => {
  let capturedOptions: any = null;
  let originalBuild: typeof Bun.build;

  beforeEach(() => {
    originalBuild = Bun.build;
    // @ts-ignore
    Bun.build = async (opts: any) => {
      capturedOptions = opts;
      return mockBunBuildSuccess();
    };
  });

  afterEach(() => {
    Bun.build = originalBuild;
    capturedOptions = null;
  });

  test("dev mode uses project sourcemap when not none", async () => {
    const project = makeProject({ sourcemap: "inline" });
    await buildProject(project, "dev");
    expect(capturedOptions.sourcemap).toBe("inline");
  });

  test("dev mode falls back to linked when sourcemap=none", async () => {
    const project = makeProject({ sourcemap: "none" });
    await buildProject(project, "dev");
    expect(capturedOptions.sourcemap).toBe("linked");
  });

  test("build mode uses project sourcemap as-is", async () => {
    const project = makeProject({ sourcemap: "none" });
    await buildProject(project, "build");
    expect(capturedOptions.sourcemap).toBe("none");
  });
});
