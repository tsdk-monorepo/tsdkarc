import { watch, existsSync, readdirSync } from "fs";
import { dirname, join, sep } from "path";
import type { ResolvedProject } from "./types";
import { buildProject } from "./builder";
import { log, logger } from "./logger";
import { loadEnvFile } from "./env";
import { startDevServer } from "./server";
import { minimatch } from "minimatch";

function needIgnore(ignorePatterns: string[], path: string) {
  return ignorePatterns.some((pattern) => {
    if (pattern.endsWith("/")) return path.startsWith(pattern);
    return minimatch(path, pattern, { dot: true });
  });
}

const DEBOUNCE_MS = 80;

const activeChildren = new Set<ReturnType<typeof Bun.spawn>>();

function cleanupZombies() {
  for (const child of activeChildren) {
    if (child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  }
}
process.on("exit", cleanupZombies);
process.on("uncaughtException", (err) => {
  console.error("\n[tsdkbundle] Uncaught Exception:", err);
  cleanupZombies();
  process.exit(1);
});

export interface WatchHandle {
  stop: () => Promise<void>;
}

interface WatchState {
  project: ResolvedProject;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  childProcess: ReturnType<typeof Bun.spawn> | null;
  devServer: ReturnType<typeof startDevServer> | null;
  building: boolean;
  pendingBuild: boolean;
  watchers: ReturnType<typeof watch>[];
}

async function killProcess(proc: ReturnType<typeof Bun.spawn> | null) {
  if (!proc || proc.exitCode !== null) return;
  activeChildren.delete(proc);
  proc.kill("SIGTERM");
  const forceTimeout = setTimeout(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }, 2000);
  await proc.exited;
  clearTimeout(forceTimeout);
}

function spawnDevProcess(state: WatchState) {
  const { project } = state;

  if (project.target === "browser") {
    if (!state.devServer) {
      state.devServer = startDevServer(project);
      logger.server(project.name, project.port ?? 3000);
    }
    return;
  }

  const env = { ...process.env };
  if (project.port) env.PORT = project.port.toString();

  const proc = Bun.spawn(["bun", "run", project.main], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    onExit: (proc, code, signal, exitCode) => {
      activeChildren.delete(proc);
      if (!state.building)
        logger.processExit(project.name, (exitCode ?? code) as number);
    },
  });

  activeChildren.add(proc);
  state.childProcess = proc;

  const streamOutput = async (stream: ReadableStream, isError: boolean) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      if (isError) logger.processError(project.name, text);
      else logger.processOutput(project.name, text);
    }
  };

  streamOutput(proc.stdout, false);
  streamOutput(proc.stderr, true);
}

/**
 * Runs build cycles in a loop, consuming any pending build requests.
 * Uses a loop instead of recursion to avoid call stack growth under
 * rapid file changes.
 */
async function runBuildCycle(state: WatchState) {
  if (state.building) {
    state.pendingBuild = true;
    return;
  }

  // FIX: loop instead of recurse so pendingBuild never overflows the stack
  while (true) {
    state.building = true;
    state.pendingBuild = false;
    logger.building(state.project.name);

    if (state.childProcess) {
      await killProcess(state.childProcess);
      state.childProcess = null;
    }

    const result = await buildProject(state.project, "dev");

    if (result.success) {
      logger.success(state.project.name, result.durationMs, result.outputs);
      spawnDevProcess(state);
    } else {
      logger.error(state.project.name, result.errors);
    }

    if (result.warnings.length > 0) {
      logger.warn(state.project.name, result.warnings);
    }

    state.building = false;

    if (!state.pendingBuild) break;
  }
}

/**
 * Debounce file-change events and skip changes emitted from outdir.
 * Uses path separator suffix to avoid prefix collisions (e.g. /dist vs /dist-foo).
 */
function scheduleBuild(state: WatchState, filename: string) {
  if (state.project.outdir) {
    const abs = join(process.cwd(), filename);
    // FIX: append sep so "/dist" doesn't match "/dist-foo"
    const outdirPrefix = state.project.outdir.endsWith(sep)
      ? state.project.outdir
      : state.project.outdir + sep;
    if (abs.startsWith(outdirPrefix) || abs === state.project.outdir) return;
  }

  logger.changed(state.project.name, filename);
  if (state.debounceTimer) clearTimeout(state.debounceTimer);

  state.debounceTimer = setTimeout(() => {
    runBuildCycle(state);
  }, DEBOUNCE_MS);
}

/** Safely watch directories, falling back to non-recursive on Linux if needed. */
function safeWatch(dir: string, state: WatchState) {
  const ignore =
    state.project.ignore?.length > 0
      ? (p: string) => needIgnore(state.project.ignore, p)
      : undefined;
  try {
    const watcher = watch(dir, { recursive: true }, (_, filename) => {
      if (filename && !ignore?.(filename)) scheduleBuild(state, filename);
    });
    state.watchers.push(watcher);
  } catch {
    log(
      state.project.name,
      "warn",
      `Native recursive watch failed, falling back to manual: ${dir}`
    );
    const dirsToWatch = [dir];

    while (dirsToWatch.length > 0) {
      const current = dirsToWatch.pop()!;
      try {
        const watcher = watch(current, { recursive: false }, (_, filename) => {
          if (filename && !ignore?.(filename))
            scheduleBuild(state, join(current, filename));
        });
        state.watchers.push(watcher);

        const entries = readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.isDirectory() &&
            entry.name !== "node_modules" &&
            entry.name !== ".git"
          ) {
            dirsToWatch.push(join(current, entry.name));
          }
        }
      } catch {
        // Ignore unreadable dirs
      }
    }
  }
}

export async function watchProjects(
  projects: ResolvedProject[]
): Promise<WatchHandle> {
  const handles = await Promise.all(
    projects.map(async (project) => {
      if (project.envFile) await loadEnvFile(project.envFile);

      const state: WatchState = {
        project,
        debounceTimer: null,
        childProcess: null,
        devServer: null,
        building: false,
        pendingBuild: false,
        watchers: [],
      };

      const dirs = new Set<string>();
      for (const entry of project.entry) dirs.add(dirname(entry));
      for (const d of project.watchDirs) {
        if (existsSync(d)) dirs.add(d);
      }

      await runBuildCycle(state);

      if (project.ignore.length > 0) {
        logger.ignore(project.name, project.ignore.join("\n"));
      }

      for (const dir of dirs) {
        logger.watching(project.name, dir);
        if (existsSync(dir)) safeWatch(dir, state);
      }

      return {
        stop: async () => {
          if (state.debounceTimer) clearTimeout(state.debounceTimer);
          for (const w of state.watchers) w.close();
          if (state.childProcess) await killProcess(state.childProcess);
          if (state.devServer) state.devServer.stop(true);
        },
      };
    })
  );

  return {
    stop: async () => {
      await Promise.all(handles.map((h) => h.stop()));
    },
  };
}
