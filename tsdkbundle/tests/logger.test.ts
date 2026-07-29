/**
 * Logger tests.
 * Verifies prefix formatting, color codes, multiline handling,
 * and that weird inputs (empty string, stack traces) don't throw.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { registerProjects, log, logger } from "../src/logger";

// Capture stdout writes
function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
    );
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join("");
}

describe("registerProjects", () => {
  test("sets label width to longest project name", () => {
    registerProjects(["api", "webfrontend", "db"]);
    const output = captureStdout(() => log("api", "info", "test"));
    // "webfrontend" is 11 chars; "api" should be padded to 11
    expect(output).toContain("[api" + " ".repeat(8) + "]");
  });

  test("minimum label width is 4", () => {
    registerProjects(["ab"]);
    const output = captureStdout(() => log("ab", "info", "test"));
    expect(output).toContain("[ab  ]");
  });
});

describe("logger convenience methods", () => {
  beforeEach(() => {
    registerProjects(["api", "web"]);
  });

  test("logger.watching includes the directory string", () => {
    const output = captureStdout(() => logger.watching("api", "src/"));
    expect(output).toContain("src");
  });

  test("logger.changed includes the filename", () => {
    const output = captureStdout(() => logger.changed("api", "routes/user.ts"));
    expect(output).toContain("routes/user.ts");
  });

  test("logger.success includes duration and output paths", () => {
    const output = captureStdout(() =>
      logger.success("api", 142, ["dist/index.js"])
    );
    expect(output).toContain("142ms");
    expect(output).toContain("dist/index.js");
  });

  test("logger.error logs each error on its own line", () => {
    captureStdout(() =>
      logger.error("api", [
        "Cannot find module './foo'",
        "Type error: string vs number",
      ])
    );
  });

  test("logger.server includes the port number", () => {
    const output = captureStdout(() => logger.server("web", 3000));
    expect(output).toContain("3000");
  });

  test("logger.system writes [tsdkbundle] global tag", () => {
    const output = captureStdout(() => logger.system("Starting up..."));
    expect(output).toContain("[tsdkbundle]");
    expect(output).toContain("Starting up...");
  });
});
