/**
 * Logger: prefixed, color-coded, aligned terminal output.
 *
 * Each project gets a stable color. All lines are padded to align
 * project name columns. Timestamps are ISO-local HH:MM:SS.
 *
 * Output format:
 *   [14:03:21] [api   ] ● watching src/
 *   [14:03:24] [web   ] ✓ rebuilt in 142ms
 */

import { relative } from "path";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
} as const;

const PROJECT_COLORS = [
  ANSI.cyan,
  ANSI.green,
  ANSI.magenta,
  ANSI.yellow,
  ANSI.brightCyan,
  ANSI.brightMagenta,
  ANSI.brightGreen,
  ANSI.brightYellow,
];

const SYMBOLS = {
  watching: "●",
  changed: "↻",
  success: "✓",
  error: "✗",
  warn: "⚠",
  build: "⬡",
  server: "⚡",
} as const;

export type LogLevel = "info" | "success" | "error" | "warn" | "raw";

const state = {
  projectColors: new Map<string, string>(),
  labelWidth: 4,
};

/**
 * Register project names before logging begins.
 * Sets label column width and assigns stable colors.
 */
export function registerProjects(names: string[]) {
  state.labelWidth = Math.max(4, ...names.map((n) => n.length));
  names.forEach((name, i) => {
    state.projectColors.set(
      name,
      PROJECT_COLORS[i % PROJECT_COLORS.length] as string
    );
  });
}

/** Returns HH:MM:SS from current local time. */
function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function projectLabel(project: string): string {
  const color = state.projectColors.get(project) ?? ANSI.white;
  const padded = project.padEnd(state.labelWidth, " ");
  return `${color}${ANSI.bold}[${padded}]${ANSI.reset}`;
}

function levelColor(level: LogLevel): string {
  switch (level) {
    case "success":
      return ANSI.brightGreen;
    case "error":
      return ANSI.brightRed;
    case "warn":
      return ANSI.brightYellow;
    case "info":
      return ANSI.dim;
    case "raw":
      return "";
  }
}

/**
 * Core log function. Handles multiline messages — each line
 * gets its own prefix so stack traces stay readable.
 */
export function log(project: string, level: LogLevel, message: string) {
  const ts = `${ANSI.dim}[${timestamp()}]${ANSI.reset}`;
  const label = projectLabel(project);
  const color = levelColor(level);

  for (const line of message.split("\n")) {
    if (line.trim() === "") continue;
    process.stdout.write(`${ts} ${label} ${color}${line}${ANSI.reset}\n`);
  }
}

/**
 * Convert an absolute path to a cwd-relative path for display.
 * Falls back to absolute if the relative path escapes cwd (starts with ..).
 */
function rel(p: string): string {
  const r = relative(process.cwd(), p);
  return r.startsWith("..") ? p : r;
}

/** Convenience wrappers. */
export const logger = {
  watching: (project: string, dir: string) =>
    log(project, "info", `${SYMBOLS.watching} watching ${rel(dir)}`),

  ignore: (project: string, dir: string) =>
    log(project, "info", `${SYMBOLS.warn} ignore watching ${rel(dir)}`),

  changed: (project: string, file: string) =>
    log(project, "info", `${SYMBOLS.changed} ${file} changed`),

  building: (project: string) =>
    log(project, "info", `${SYMBOLS.build} building...`),

  success: (project: string, durationMs: number, outputs: string[]) =>
    log(
      project,
      "success",
      `${SYMBOLS.success} built in ${durationMs}ms → ${outputs
        .map(rel)
        .join(", ")}`
    ),

  error: (project: string, errors: string[]) => {
    log(project, "error", `${SYMBOLS.error} build failed`);
    for (const err of errors) {
      log(project, "error", `  ${err}`);
    }
  },

  warn: (project: string, warnings: string[]) => {
    for (const w of warnings) {
      log(project, "warn", `${SYMBOLS.warn} ${w}`);
    }
  },

  server: (project: string, port: number) =>
    log(
      project,
      "success",
      `${SYMBOLS.server} dev server → http://localhost:${port}`
    ),

  processOutput: (project: string, data: string) =>
    log(project, "raw", data.trimEnd()),

  processError: (project: string, data: string) =>
    log(project, "error", data.trimEnd()),

  processExit: (project: string, code: number | null) =>
    log(
      project,
      code === 0 ? "info" : "error",
      `process exited (code ${code ?? "null"})`
    ),

  /** Top-level system messages not tied to a project. */
  system: (message: string) => {
    const ts = `${ANSI.dim}[${timestamp()}]${ANSI.reset}`;
    process.stdout.write(
      `${ts} ${ANSI.bold}${ANSI.blue}[tsdkbundle]${ANSI.reset} ${message}\n`
    );
  },
};
