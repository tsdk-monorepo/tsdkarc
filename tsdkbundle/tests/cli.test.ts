/**
 * CLI arg parser tests.
 * Covers: commands, project names, --config flag,
 * "all" keyword, errors on bad input.
 */

import { describe, test, expect } from "bun:test";
import { parseArgs } from "../src/cli-args";

describe("parseArgs: commands", () => {
  test("parses dev command", () => {
    const result = parseArgs(["dev"]);
    expect(result.command).toBe("dev");
  });

  test("parses build command", () => {
    const result = parseArgs(["build"]);
    expect(result.command).toBe("build");
  });

  test("throws on unknown command", () => {
    expect(() => parseArgs(["watch"])).toThrow();
  });

  test("throws on empty args", () => {
    expect(() => parseArgs([])).toThrow();
  });

  test("throws on --help", () => {
    expect(() => parseArgs(["--help"])).toThrow();
  });

  test("throws on -h", () => {
    expect(() => parseArgs(["-h"])).toThrow();
  });
});

describe("parseArgs: project names", () => {
  test("no projects defaults to empty array", () => {
    const result = parseArgs(["dev"]);
    expect(result.projects).toEqual([]);
  });

  test("single project name", () => {
    const result = parseArgs(["dev", "api"]);
    expect(result.projects).toEqual(["api"]);
  });

  test("multiple project names", () => {
    const result = parseArgs(["dev", "api", "web"]);
    expect(result.projects).toEqual(["api", "web"]);
  });

  test("build all parses to selectAll flag", () => {
    const result = parseArgs(["build", "all"]);
    expect(result.selectAll).toBe(true);
    expect(result.projects).toEqual([]);
  });

  test("dev all throws error", () => {
    expect(() => parseArgs(["dev", "all"])).toThrow();
  });
});

describe("parseArgs: config flag", () => {
  test("default config path", () => {
    const result = parseArgs(["dev"]);
    expect(result.configPath).toBe("bundle.config.ts");
  });

  test("--config with path", () => {
    const result = parseArgs(["dev", "--config", "./my.config.ts"]);
    expect(result.configPath).toBe("./my.config.ts");
  });

  test("-c shorthand", () => {
    const result = parseArgs(["build", "-c", "configs/bundle.ts"]);
    expect(result.configPath).toBe("configs/bundle.ts");
  });

  test("--config without value throws", () => {
    expect(() => parseArgs(["dev", "--config"])).toThrow();
  });

  test("projects and --config together", () => {
    const result = parseArgs(["dev", "api", "web", "--config", "./custom.ts"]);
    expect(result.projects).toEqual(["api", "web"]);
    expect(result.configPath).toBe("./custom.ts");
  });
});
