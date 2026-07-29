/**
 * Interactive multi-select prompt.
 * Used when `bb dev` or `bb build` is called with no project names
 * and no defaults are configured.
 *
 * Input:  string[] of project names
 * Output: string[] of selected project names
 *
 * Controls:
 *   ↑/↓ or j/k  — move cursor
 *   Space        — toggle selection
 *   a            — select all / deselect all
 *   Enter        — confirm
 *   Ctrl+C / q   — abort
 */

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  up: "\x1b[A",
  clearLine: "\x1b[2K\r",
};

/** Thrown when user aborts the prompt (Ctrl+C or q). */
export class SelectAbortError extends Error {
  constructor() {
    super("Selection aborted.");
    this.name = "SelectAbortError";
  }
}

/**
 * Present an interactive multi-select to the user.
 * Returns the selected project names.
 * Throws SelectAbortError if aborted.
 */
export async function multiSelect(
  prompt: string,
  options: string[]
): Promise<string[]> {
  if (options.length === 0) return [];

  // Interactive select requires a real TTY — piped output or CI will break the
  // ANSI cursor movement. Fail fast with an actionable message.
  if (!process.stdout.isTTY) {
    throw new Error(
      "Interactive project select requires a TTY. " +
      "Pass project names explicitly: bb dev api web"
    );
  }

  // Single option: no need to prompt
  if (options.length === 1) {
    process.stdout.write(`${ANSI.dim}Auto-selected: ${options[0]}${ANSI.reset}\n`);
    return [options[0]!];
  }

  let cursor = 0;
  const selected = new Set<number>();

  function render() {
    // Move cursor up to redraw from top (after first render)
    const lines = options.length + 2;
    for (let i = 0; i < lines; i++) {
      process.stdout.write(ANSI.up + ANSI.clearLine);
    }

    process.stdout.write(`${ANSI.bold}${prompt}${ANSI.reset}\n`);
    process.stdout.write(`${ANSI.dim}↑/↓ move  Space toggle  a all  Enter confirm${ANSI.reset}\n`);

    for (let i = 0; i < options.length; i++) {
      const isCursor = i === cursor;
      const isSelected = selected.has(i);

      const pointer = isCursor ? `${ANSI.cyan}›${ANSI.reset}` : " ";
      const check = isSelected
        ? `${ANSI.green}◉${ANSI.reset}`
        : `${ANSI.dim}○${ANSI.reset}`;

      const name = isCursor
        ? `${ANSI.bold}${options[i]}${ANSI.reset}`
        : options[i];

      process.stdout.write(`${pointer} ${check} ${name}\n`);
    }
  }

  // Initial render — write blank lines first so redraw can overwrite them
  const initialLines = options.length + 2;
  for (let i = 0; i < initialLines; i++) {
    process.stdout.write("\n");
  }
  render();

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
    }

    function onData(key: string) {
      const code = key.charCodeAt(0);

      // Ctrl+C
      if (code === 3 || key === "q") {
        cleanup();
        reject(new SelectAbortError());
        return;
      }

      // Enter
      if (code === 13) {
        cleanup();
        resolve(Array.from(selected).map((i) => options[i]) as string[]);
        return;
      }

      // Space — toggle
      if (code === 32) {
        if (selected.has(cursor)) {
          selected.delete(cursor);
        } else {
          selected.add(cursor);
        }
        render();
        return;
      }

      // 'a' — toggle all
      if (key === "a") {
        if (selected.size === options.length) {
          selected.clear();
        } else {
          options.forEach((_, i) => selected.add(i));
        }
        render();
        return;
      }

      // Arrow up / k
      if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
        return;
      }

      // Arrow down / j
      if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % options.length;
        render();
        return;
      }
    }

    stdin.on("data", onData);
  });
}
