/**
 * CLI argument parser.
 *
 * Supported syntax:
 *   bb dev
 *   bb dev api web
 *   bb build
 *   bb build all
 *   bb build api web
 *   bb dev --config ./my-bundle.config.ts
 *
 * Input:  string[] (process.argv.slice(2))
 * Output: CliArgs
 */

import type { CliArgs } from "./types";

export class CliParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliParseError";
  }
}

const USAGE = `
Usage:
  bb dev [project...] [--config <path>]
  bb build [project... | all] [--config <path>]

Examples:
  bb dev                         Run default projects in watch mode
  bb dev api web                 Run "api" and "web" in watch mode
  bb build all                   Build all projects
  bb build api                   Build "api" only
  bb dev --config ./my.config.ts Use a custom config file

Options:
  --config, -c   Path to config file (default: bundle.config.ts)
  --help, -h     Show this help message
`.trim();

/**
 * Parse raw argv into a CliArgs struct.
 * Throws CliParseError on invalid input.
 */
export function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    throw new CliParseError(USAGE);
  }

  const command = argv[0] as string;
  if (command !== "dev" && command !== "build") {
    throw new CliParseError(
      `Unknown command "${command}". Expected "dev" or "build".\n\n${USAGE}`
    );
  }

  let configPath = "bundle.config.ts";
  const projects: string[] = [];

  const rest = argv.slice(1);
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];

    if (arg === "--config" || arg === "-c") {
      const next = rest[i + 1];
      if (!next || next.startsWith("-")) {
        throw new CliParseError(`"${arg}" requires a path argument.`);
      }
      configPath = next;
      i += 2;
      continue;
    }

    if (arg?.startsWith("-")) {
      throw new CliParseError(`Unknown option "${arg}".\n\n${USAGE}`);
    }

    // "all" is a special keyword for build only
    if (arg === "all") {
      if (command !== "build") {
        throw new CliParseError(`"all" is only valid with "build", not "dev".`);
      }
      // Return early: "all" means we pass no project names (resolver handles it)
      return { command, projects: [], configPath, selectAll: true };
    }

    projects.push(arg as string);
    i++;
  }

  return { command, projects, configPath, selectAll: false };
}
