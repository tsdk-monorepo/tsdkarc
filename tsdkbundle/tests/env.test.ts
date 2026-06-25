/**
 * Env file parser tests.
 * Tests parseEnvFile in isolation — no disk I/O required.
 * Ensures we can handle complex dotenv cases, exports, and multiline.
 */

import { describe, test, expect } from "bun:test";
import { parseEnvFile } from "../src/env";

describe("parseEnvFile: basic parsing", () => {
  test("simple KEY=value", () => {
    const result = parseEnvFile("KEY=value");
    expect(result.KEY).toBe("value");
  });

  test("double-quoted value", () => {
    const result = parseEnvFile(`KEY="hello world"`);
    expect(result.KEY).toBe("hello world");
  });

  test("single-quoted value", () => {
    const result = parseEnvFile(`KEY='hello world'`);
    expect(result.KEY).toBe("hello world");
  });

  test("comment lines are skipped", () => {
    const result = parseEnvFile("# this is a comment\nKEY=value");
    expect(result["# this is a comment"]).toBeUndefined();
    expect(result.KEY).toBe("value");
  });

  test("blank lines are skipped", () => {
    const result = parseEnvFile("\n\nKEY=value\n\n");
    expect(Object.keys(result)).toHaveLength(1);
  });

  test("multiple keys", () => {
    const result = parseEnvFile("A=1\nB=2\nC=3");
    expect(result.A).toBe("1");
    expect(result.B).toBe("2");
    expect(result.C).toBe("3");
  });
});

describe("parseEnvFile: edge cases and new features", () => {
  test("value with equals sign", () => {
    const result = parseEnvFile("KEY=a=b=c");
    expect(result.KEY).toBe("a=b=c");
  });

  test("empty value", () => {
    const result = parseEnvFile("KEY=");
    expect(result.KEY).toBe("");
  });

  test("lines without = are skipped", () => {
    const result = parseEnvFile("NOVALUE\nKEY=value");
    expect(result.NOVALUE).toBeUndefined();
    expect(result.KEY).toBe("value");
  });

  test("export KEY=value is stripped", () => {
    const result = parseEnvFile("export MY_PORT=8080");
    expect(result.MY_PORT).toBe("8080");
    expect(result["export MY_PORT"]).toBeUndefined();
  });

  test("newline expansion in double quotes", () => {
    const result = parseEnvFile('CERT="-----BEGIN CERT-----\\nMADE UP\\n-----END CERT-----"');
    expect(result.CERT).toBe("-----BEGIN CERT-----\nMADE UP\n-----END CERT-----");
  });

  test("inline comment stripped for unquoted value", () => {
    const result = parseEnvFile("KEY=value # inline comment");
    expect(result.KEY).toBe("value");
  });

  test("inline comment NOT stripped inside double quotes", () => {
    const result = parseEnvFile(`KEY="value # not a comment"`);
    expect(result.KEY).toBe("value # not a comment");
  });
});