#!/usr/bin/env bun
/**
 * tsdkbundle CLI entry point.
 *
 * Flow:
 * 1. Parse argv → CliArgs
 * 2. Load + validate bundle.config.ts → ResolvedProject[]
 * 3. Resolve which projects to run (CLI args → default → prompt)
 * 4. Register logger colors/widths
 * 5. dev: port conflict check → watch projects → watch config for smart restart
 * build: build all selected projects in parallel, report results
 */

import { watch, existsSync } from "fs";
import { resolve, basename } from "path";
import { parseArgs } from "./cli-args";
import { loadConfig, findConfigPath, ConfigValidationError } from "./config";
import { registerProjects, logger } from "./logger";
import { multiSelect, SelectAbortError } from "./select";
import { watchProjects } from "./watcher";
import { buildProjects } from "./builder";
import type { ResolvedProject } from "./types";

async function isPortInUse(port: number): Promise<boolean> {
  try {
    const conn = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: { data() {}, open() {}, close() {}, error() {} },
    });
    conn.end();
    return true;
  } catch {
    return false;
  }
}

async function checkPorts(projects: ResolvedProject[]) {
  const withPorts = projects.filter((p) => p.port !== null);
  if (withPorts.length === 0) return;

  const seen = new Map<number, string>();
  for (const p of withPorts) {
    const existing = seen.get(p.port!);
    if (existing) {
      process.stderr.write(
        `Port conflict: both "${existing}" and "${p.name}" are configured on port ${p.port}.\n`
      );
      process.exit(1);
    }
    seen.set(p.port!, p.name);
  }

  const checks = await Promise.all(
    withPorts.map(async (p) => ({
      name: p.name,
      port: p.port!,
      inUse: await isPortInUse(p.port!),
    }))
  );

  const occupied = checks.filter((c) => c.inUse);
  if (occupied.length > 0) {
    for (const c of occupied) {
      process.stderr.write(
        `Port ${c.port} is already in use (project "${c.name}").\n`
      );
    }
    process.exit(1);
  }
}

async function startDevSession(
  selected: ResolvedProject[]
): Promise<() => Promise<void>> {
  logger.system(
    `Starting dev mode for: ${selected.map((p) => p.name).join(", ")}`
  );
  await checkPorts(selected);
  const watchHandle = await watchProjects(selected);
  return () => watchHandle.stop();
}

async function main() {
  let args: ReturnType<typeof parseArgs>;

  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof Error) process.stdout.write(err.message + "\n");
    process.exit(err instanceof Error && err.name === "CliParseError" ? 0 : 1);
  }

  if (args.projects.length > 0) {
    args.projects = [...new Set(args.projects)];
  }

  let configPath = args.configPath;
  const discovered = findConfigPath(process.cwd());
  let hasConfig = true;

  if (!discovered && configPath === "bundle.config.ts") {
    hasConfig = false;
  }
  if (configPath === "bundle.config.ts" && discovered) configPath = discovered;

  let configResult: Awaited<ReturnType<typeof loadConfig>> = {
    projects: {},
    defaultProjects: [],
  };
  const inlineProjects: Record<string, ResolvedProject> = {};

  if (hasConfig) {
    try {
      configResult = await loadConfig(configPath, args.command); // PASS COMMAND
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        process.stderr.write(err.message + "\n");
      } else if (err instanceof Error) {
        process.stderr.write(`Failed to load config: ${err.message}\n`);
      }
      process.exit(1);
    }
  } else if (args.projects.length === 0) {
    process.stderr.write(
      "No bundle.config.ts (or .js / .json) found in the current directory.\n" +
        "Run from your project root, pass --config <path>, or provide an entry file inline.\n"
    );
    process.exit(1);
  }

  const { projects, defaultProjects } = configResult;
  const allProjectNames = Object.keys(projects);
  let selectedNames: string[];
  let inlinePortCounter = 3000;

  if (args.selectAll) {
    selectedNames = allProjectNames;
  } else if (args.projects.length > 0) {
    const unknown = args.projects.filter((n) => !projects[n]);

    if (unknown.length > 0) {
      for (const file of unknown) {
        const absPath = resolve(process.cwd(), file);
        if (!existsSync(absPath)) {
          process.stderr.write(
            `Unknown project or file not found: ${file}\n` +
              (allProjectNames.length > 0
                ? `Available projects: ${allProjectNames.join(", ")}\n`
                : "")
          );
          process.exit(1);
        }

        const isFrontend = file.endsWith(".html") || file.endsWith(".htm");
        const name = basename(file).replace(/\.[^/.]+$/, "");
        let finalName = name;
        let counter = 1;

        while (projects[finalName] || inlineProjects[finalName]) {
          finalName = `${name}-${counter++}`;
        }

        const outdir = resolve(process.cwd(), "dist");

        const inlineProj: ResolvedProject = {
          name: finalName,
          target: isFrontend ? "browser" : "bun",
          entry: [absPath],
          main: resolve(
            outdir,
            basename(absPath).replace(/\.[a-zA-Z0-9]+$/, ".js")
          ),
          tsconfig: resolve(process.cwd(), "tsconfig.json"),
          outdir,
          envFile: null,
          external: [],
          sourcemap: "linked",
          minify: false,
          port: isFrontend ? inlinePortCounter++ : null,
          watchDirs: [],
          ignore: [],
          plugins: [], // Add empty plugins array here
        };

        inlineProjects[finalName] = inlineProj;
        projects[finalName] = inlineProj;

        const idx = args.projects.indexOf(file);
        args.projects[idx] = finalName;
        allProjectNames.push(finalName);
      }
    }
    selectedNames = args.projects;
  } else if (defaultProjects.length > 0) {
    selectedNames = defaultProjects;
    logger.system(`Using default projects: ${selectedNames.join(", ")}`);
  } else {
    try {
      selectedNames = await multiSelect(
        `Select projects to ${args.command}:`,
        allProjectNames
      );
      if (selectedNames.length === 0) {
        process.stdout.write("No projects selected. Exiting.\n");
        process.exit(0);
      }
    } catch (err) {
      if (err instanceof SelectAbortError) {
        process.stdout.write("\nAborted.\n");
        process.exit(0);
      }
      throw err;
    }
  }

  registerProjects(selectedNames);

  if (args.command === "dev") {
    let selected = selectedNames.map((n) => projects[n]!);
    let stopSession = await startDevSession(selected);

    let configRestartTimer: ReturnType<typeof setTimeout> | null = null;
    let configWatcher: ReturnType<typeof watch> | null = null;

    if (hasConfig) {
      configWatcher = watch(configPath, () => {
        if (configRestartTimer) clearTimeout(configRestartTimer);
        configRestartTimer = setTimeout(async () => {
          configRestartTimer = null;
          logger.system("bundle.config changed — reloading...");
          await stopSession();

          try {
            const fresh = await loadConfig(configPath, args.command); // PASS COMMAND ON RELOAD
            Object.assign(fresh.projects, inlineProjects);

            let freshSelected: ResolvedProject[];
            if (args.selectAll) {
              freshSelected = Object.values(fresh.projects);
            } else if (args.projects.length > 0) {
              const missing = args.projects.filter((n) => !fresh.projects[n]);
              if (missing.length > 0) {
                logger.system(
                  `Projects no longer in config: ${missing.join(", ")}`
                );
              }
              freshSelected = args.projects
                .filter((n) => fresh.projects[n])
                .map((n) => fresh.projects[n]!);
            } else if (
              fresh.defaultProjects &&
              fresh.defaultProjects.length > 0
            ) {
              freshSelected = fresh.defaultProjects
                .filter((n) => fresh.projects[n])
                .map((n) => fresh.projects[n]!);
            } else {
              freshSelected = selectedNames
                .filter((n) => fresh.projects[n])
                .map((n) => fresh.projects[n]!);
            }

            if (freshSelected.length === 0) {
              logger.system(
                "No runnable projects in updated config. Waiting for further changes..."
              );
              return;
            }

            registerProjects(freshSelected.map((p) => p.name));
            stopSession = await startDevSession(freshSelected);
          } catch (err) {
            if (err instanceof ConfigValidationError) {
              logger.system(
                `Config error — fix and save to retry:\n${err.message}`
              );
            } else {
              logger.system(
                `Failed to reload config: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            }
          }
        }, 200);
      });
    }

    let isShuttingDown = false;
    const shutdown = async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.system("Shutting down...");
      if (configWatcher) configWatcher.close();
      if (configRestartTimer) clearTimeout(configRestartTimer);
      await stopSession();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.stdin.resume();
    return;
  }

  logger.system(`Building: ${selectedNames.join(", ")}`);

  const selected = selectedNames.map((n) => projects[n]!);
  const results = await buildProjects(selected, "build");

  let allSuccess = true;
  for (const result of results) {
    if (result.success) {
      logger.success(result.project, result.durationMs, result.outputs);
    } else {
      logger.error(result.project, result.errors);
      allSuccess = false;
    }
    if (result.warnings.length > 0)
      logger.warn(result.project, result.warnings);
  }

  logger.system(
    `Build complete: ${results.filter((r) => r.success).length}/${
      results.length
    } succeeded`
  );
  process.exit(allSuccess ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(
    `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + "\n");
  process.exit(1);
});
