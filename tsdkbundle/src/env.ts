import { existsSync } from "fs";

/**
 * Parse a .env file into key-value pairs.
 * Handles: KEY=value, KEY="value", export KEY=val, # comments, blank lines.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  const lines = content.split(/\r?\n/);

  for (let line of lines) {
    line = line.trim();

    // Skip blanks and full line comments
    if (!line || line.startsWith("#")) continue;

    // Handle "export KEY=value"
    if (line.startsWith("export ")) {
      line = line.slice(7).trim();
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    // Handle Quoted strings
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      // Double quotes: strip quotes and expand newlines
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    } else if (
      value.startsWith("'") &&
      value.endsWith("'") &&
      value.length >= 2
    ) {
      // Single quotes: strictly literal, just strip quotes
      value = value.slice(1, -1);
    } else {
      // Unquoted: Strip inline comments
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Load a .env file into process.env.
 * Existing env vars are NOT overwritten.
 */
export async function loadEnvFile(
  filePath: string
): Promise<Record<string, string>> {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = await Bun.file(filePath).text();
  const parsed = parseEnvFile(content);
  const loaded: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded[key] = value;
    }
  }

  return loaded;
}
