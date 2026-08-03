#!/usr/bin/env node
/**
 * Codemod: adds explicit .js extensions to relative import/export specifiers.
 *
 * Input:  project root (cwd), all *.js files matched via fast-glob "**\/*.js"
 * Output: files rewritten in place; a JSON summary printed to stdout
 *
 * Resolution order for a bare relative specifier "./foo":
 *   1. "./foo.js"        exists -> rewrite to "./foo.js"
 *   2. "./foo/index.js"  exists -> rewrite to "./foo/index.js"
 *   3. neither exists    -> leave unchanged, log as unresolved
 *
 * Assumptions:
 * - Only relative specifiers ("./" or "../") are touched. Bare package
 *   specifiers ("react", "node:fs") are never modified.
 * - A specifier that already ends in a known extension is left unchanged.
 * - Regex-based scanning is used instead of a full JS parser. This covers
 *   standard static import/export/dynamic-import forms but can miss or
 *   mis-scan pathological syntax (e.g. specifiers built from template
 *   literals, or the substrings appearing inside strings/comments that
 *   look like import statements). Re-run and diff after use.
 */

import fg from "fast-glob";
import fs from "node:fs";
import path from "node:path";

const KNOWN_EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".jsx", ".ts", ".tsx", ".node"];

const STATIC_IMPORT_RE = /\b(?:import|export)\b[^'"()]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * All *.js files under root, excluding node_modules and dist-like output dirs.
 * @param root string
 * @returns string[] absolute file paths
 */
async function findJsFiles(root) {
  const entries = await fg("**/*.js", {
    cwd: root,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  });
  return entries;
}

/**
 * Whether a specifier should be considered for rewriting.
 * @param specifier string
 * @returns boolean
 */
function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * Whether a specifier already carries a recognized extension.
 * @param specifier string
 * @returns boolean
 */
function hasKnownExtension(specifier) {
  const ext = path.extname(specifier.split("?")[0].split("#")[0]);
  return KNOWN_EXTENSIONS.includes(ext);
}

/**
 * Resolve a bare relative specifier to an on-disk file, per the resolution
 * order documented at the top of this file.
 * @param fromFile string absolute path of the file containing the import
 * @param specifier string relative specifier, no extension
 * @returns { resolved: string|null, reason: string }
 */
function resolveExtension(fromFile, specifier) {
  const baseDir = path.dirname(fromFile);
  const asDirectFile = path.resolve(baseDir, `${specifier}.js`);
  if (fs.existsSync(asDirectFile)) {
    return { resolved: `${specifier}.js`, reason: "direct-file" };
  }

  const asIndexFile = path.resolve(baseDir, specifier, "index.js");
  if (fs.existsSync(asIndexFile)) {
    const normalized = specifier.endsWith("/") ? specifier : `${specifier}/`;
    return { resolved: `${normalized}index.js`, reason: "index-file" };
  }

  return { resolved: null, reason: "not-found" };
}

/**
 * Find every relative, extensionless specifier in source code and compute
 * its replacement, without mutating the string yet.
 * @param code string
 * @param filePath string absolute path, used for on-disk resolution
 * @returns { edits: Array<{start:number,end:number,original:string,replacement:string}>, unresolved: string[] }
 */
function planEdits(code, filePath) {
  const edits = [];
  const unresolved = [];
  const patterns = [STATIC_IMPORT_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_IMPORT_RE];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const specifier = match[1];
      if (!isRelativeSpecifier(specifier) || hasKnownExtension(specifier)) continue;

      const { resolved, reason } = resolveExtension(filePath, specifier);
      const specifierStart = match.index + match[0].lastIndexOf(specifier);
      const specifierEnd = specifierStart + specifier.length;

      if (resolved === null) {
        unresolved.push(specifier);
        continue;
      }

      edits.push({ start: specifierStart, end: specifierEnd, original: specifier, replacement: resolved, reason });
    }
  }

  return { edits, unresolved };
}

/**
 * Apply planned edits to source code, right-to-left so indices stay valid.
 * @param code string
 * @param edits Array<{start:number,end:number,replacement:string}>
 * @returns string rewritten code
 */
function applyEdits(code, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let output = code;
  for (const edit of sorted) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}

/**
 * Process a single file: plan edits, write if changed, report result.
 * @param filePath string absolute path
 * @returns { filePath: string, changed: number, unresolved: string[] }
 */
function processFile(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const { edits, unresolved } = planEdits(code, filePath);

  if (edits.length > 0) {
    const rewritten = applyEdits(code, edits);
    fs.writeFileSync(filePath, rewritten, "utf8");
  }

  return { filePath, changed: edits.length, unresolved };
}

/**
 * Entry point. Scans cwd for *.js files and fixes extensionless relative imports.
 * @returns void
 */
async function main() {
  const root = process.cwd();
  const files = await findJsFiles(root);

  const summary = {
    root,
    filesScanned: files.length,
    filesChanged: 0,
    totalEditsApplied: 0,
    unresolvedSpecifiers: [],
  };

  for (const filePath of files) {
    const result = processFile(filePath);
    if (result.changed > 0) {
      summary.filesChanged += 1;
      summary.totalEditsApplied += result.changed;
      console.log(JSON.stringify({ level: "info", event: "file-updated", file: path.relative(root, filePath), edits: result.changed }));
    }
    if (result.unresolved.length > 0) {
      for (const spec of result.unresolved) {
        summary.unresolvedSpecifiers.push({ file: path.relative(root, filePath), specifier: spec });
      }
      console.log(JSON.stringify({ level: "warn", event: "unresolved-specifier", file: path.relative(root, filePath), specifiers: result.unresolved }));
    }
  }

  console.log(JSON.stringify({ level: "info", event: "summary", ...summary }));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", event: "fatal", message: err.message, stack: err.stack }));
  process.exit(1);
});
