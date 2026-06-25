# tsdkbundle

ESM-only build and watch tool for [Bun](https://bun.sh) projects. Supports frontend and backend projects in a single monorepo, with per-project TypeScript configs, strong parallel logging, and a clean CLI.

---

## Install

```sh
bun add -d tsdkbundle
```

Or run directly with `bunx`:

```sh
bunx tsdkbundle dev
```

---

## Quick Start

Create `bundle.config.ts` in your project root:

```ts
import type { BundleConfig } from "tsdkbundle";

export default {
  projects: {
    api: {
      type: "backend",
      entry: ["src/index.ts"],
      tsconfig: "tsconfig.json",
      outdir: "dist/api",
      envFile: ".env",
      external: ["pg", "bcrypt"],
    },
    web: {
      type: "frontend",
      entry: "src/main.tsx",
      tsconfig: "tsconfig.app.json",
      outdir: "dist/web",
      publicDir: "public",
      port: 3000,
    },
  },
  default: ["api"],
} satisfies BundleConfig;
```

---

## CLI

```
bb dev [project...] [--config <path>]
bb build [project... | all] [--config <path>]
```

| Command                    | Effect                                           |
| -------------------------- | ------------------------------------------------ |
| `bb dev`                   | Watch default projects (or prompt if no default) |
| `bb dev api web`           | Watch `api` and `web` in parallel                |
| `bb build`                 | Build default projects                           |
| `bb build all`             | Build every project                              |
| `bb build api`             | Build `api` only                                 |
| `bb dev --config ./cfg.ts` | Use a custom config file                         |

Both `bb` and `tsdkbundle` are available as bin aliases.

---

## Config Reference

### `BundleConfig`

| Field      | Type                            | Required | Description                             |
| ---------- | ------------------------------- | -------- | --------------------------------------- |
| `projects` | `Record<string, ProjectConfig>` | ✅       | Map of project name → config            |
| `default`  | `string[]`                      | —        | Projects to run when no names are given |

### `ProjectConfig`

| Field        | Type                                           | Default           | Description                                                    |
| ------------ | ---------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| `type`       | `"backend" \| "frontend"`                      | ✅ required       | Build target                                                   |
| `entry`      | `string \| string[]`                           | ✅ required       | Entry file(s)                                                  |
| `tsconfig`   | `string`                                       | `"tsconfig.json"` | Path to tsconfig                                               |
| `outdir`     | `string`                                       | `"dist/<name>"`   | Output directory                                               |
| `envFile`    | `string`                                       | —                 | `.env` file to load before spawning backend                    |
| `external`   | `string[]`                                     | `[]`              | Packages to exclude from bundle                                |
| `sourcemap`  | `"none" \| "inline" \| "linked" \| "external"` | `"linked"`        | Sourcemap mode                                                 |
| `minify`     | `boolean`                                      | `false`           | Minify output (in build mode)                                  |
| `port`       | `number`                                       | —                 | Frontend: static dev server port. Backend: sets `PORT` env var |
| `publicDir`  | `string`                                       | —                 | Static assets directory (frontend)                             |
| `watchExtra` | `string[]`                                     | `[]`              | Extra directories/globs to watch                               |

---

## How It Works

### `bb dev`

1. Loads `bundle.config.ts` and resolves selected projects.
2. Runs an initial `Bun.build` for each project.
3. **Backend**: Spawns `bun run dist/<name>/index.js` and restarts it on each rebuild. Stdout/stderr from the child process is piped through tsdkbundle's prefixed logger.
4. **Frontend**: Starts a static file server (`Bun.serve`) pointing at `outdir`. Rebuilds on change; browser refreshes manually.
5. Watches source directories with `fs.watch` (recursive). Debounces changes at 80ms. If a change arrives during a build, exactly one follow-up build is queued.

### `bb build`

Runs `Bun.build` for all selected projects in parallel. Exits `0` if all succeed, `1` if any fail.

### Logging

All output is prefixed with timestamp, color-coded project label, and symbol:

```
[14:03:21] [api   ] ● watching src/
[14:03:24] [api   ] ↻ routes/user.ts changed
[14:03:24] [api   ] ⬡ building...
[14:03:24] [api   ] ✓ built in 142ms → dist/api/index.js
[14:03:25] [web   ] ✗ build failed
[14:03:25] [web   ]   Cannot find module './Button'
```

Each project gets a stable color. Column widths auto-align to the longest project name.

---

## FAQ

**Q: Does this work with monorepos?**  
A: Yes — add all sub-projects to `bundle.config.ts` and run `bb dev api web worker` (or whatever names you use). Each project can have its own `tsconfig.json`, `outdir`, and `envFile`.

**Q: Can I use this with CommonJS projects?**  
A: No. tsdkbundle is ESM-only. All output uses `format: "esm"`. CJS projects should use their own build tooling.

**Q: Does frontend dev mode support HMR?**  
A: Not yet. It rebuilds on change and serves from `outdir`. Full HMR requires a WebSocket injection step that is on the roadmap.

**Q: Why not just use `bun --watch`?**  
A: `bun --watch` hijacks stdout and breaks the prefixed, color-coded multi-project log format. tsdkbundle uses a custom watcher to preserve full control over output.

**Q: My `.env` file isn't loading for the backend.**  
A: Check that `envFile` is set in the project config and the path is correct relative to `bundle.config.ts`. tsdkbundle does not overwrite existing environment variables, so values already set in your shell take precedence.

**Q: Config file isn't found.**  
A: tsdkbundle looks for `bundle.config.ts`, then `bundle.config.js`, then `bundle.config.json` in the current working directory. Run `bb` from the directory containing your config, or pass `--config <path>`.

**Q: Can I have multiple entry points for a backend project?**  
A: Yes — set `entry` to an array. Bun will produce one output file per entry in `outdir`. Note that the dev mode spawner assumes `dist/<name>/index.js` as the main process entry; rename accordingly or open an issue for configurable spawn targets.

---

## Development

```sh
bun test          # run all tests
bun run typecheck # tsc --noEmit
```

````ts
/**
 * ### 💡 tsdkbundle (bb) 配置与 CLI 速查表
 *
 * **`BundleConfig` (静态配置) | `BundleConfigFn` (动态配置)**
 * - 可导出一个静态对象，或一个接收 `ctx: { command: "dev" | "build" }` 的回调函数，用于区分环境。
 * - `default` *(可选)*: `string[]`，当 CLI 未指定项目时的默认启动列表。
 * - `projects`: `Record<string, ProjectConfig>`，项目配置字典。
 *
 * **`ProjectConfig` (单项目配置)**
 * - `type`: `"backend" | "frontend"` — 决定默认的 target，以及 dev 模式是 Spawn 子进程还是开启静态服务器。
 * - `target` *(可选)*: `"bun" | "browser" | "node"` — 编译目标（不传时，backend 默认 bun，frontend 默认 browser）。
 * - `entry`: `string | string[]` — 编译入口文件（支持多入口）。
 * - `main` *(可选)*: dev 模式下启动的主进程文件（backend 专用，默认为 entry 编译后的产物）。
 * - `outdir` *(可选)*: 输出目录，默认为 `dist/<projectName>`。
 * - `envFile` *(可选)*: 环境变量文件路径（如 `".env"`），启动前自动合并至 process.env（支持多行与 export 语法）。
 * - `port` *(可选)*: backend 会注入为 `process.env.PORT`，frontend 会作为本地静态服务器的端口。
 * - `external` *(可选)*: 排除打包的第三方依赖数组（如 `["pg", "bcrypt"]`）。**内置 node 模块会自动排除**。
 * - `sourcemap` *(可选)*: `"none" | "inline" | "linked" | "external"`。
 * - `minify` *(可选)*: `boolean`，是否压缩代码。
 * - `watchDirs` *(可选)*: `string[]`，dev 模式下额外监听的目录（如非 TS 的 HTML 模板、SQL 文件夹）。
 * - `plugins` *(可选)*: `BunPlugin[]`，原生 Bun 插件数组（如 yaml、css 预处理插件）。
 *
 * ---
 *
 * ### 📖 典型配置示例 (Examples)
 *
 * #### 1. 基础全栈配置 (Static Config)
 * 最常见的场景：一个后端 API 服务 + 一个前端 React/Vue 单页应用。
 * ```typescript
 * import type { BundleConfig } from "tsdkbundle";
 * * export default {
 * default: ["api", "web"],
 * projects: {
 * api: {
 * type: "backend",
 * entry: "src/api/index.ts",
 * envFile: ".env",
 * port: 3000,
 * external: ["pg", "bcrypt"], // C++ 扩展需要排除
 * },
 * web: {
 * type: "frontend",
 * entry: "src/web/index.tsx",
 * port: 8080, // dev 模式下的静态服务器端口
 * }
 * }
 * } satisfies BundleConfig;
 * ```
 * * #### 2. 高级动态配置 (Dynamic Config)
 * 根据当前的 CLI 命令 (`dev` 还是 `build`) 来动态决定是否压缩代码、是否生成 sourcemap。
 * ```typescript
 * import type { BundleConfigFn } from "tsdkbundle";
 * import yamlPlugin from "bun-plugin-yaml";
 * * export default (({ command }) => {
 * const isProd = command === "build";
 * * return {
 * projects: {
 * worker: {
 * type: "backend",
 * entry: ["src/worker.ts"],
 * minify: isProd, // 生产环境压缩
 * sourcemap: isProd ? "none" : "linked", // 生产环境不泄露源码
 * plugins: [yamlPlugin()], // 使用原生 Bun 插件
 * }
 * }
 * };
 * }) satisfies BundleConfigFn;
 * ```
 *
 * ---
 *
 * ### 💻 CLI 命令行速查
 * - **`bb dev`**: 启动 `default` 列表中定义的所有项目（防冲突检查 -> 并行构建 -> 监听并运行）。
 * - **`bb dev api web`**: 仅启动 `api` 和 `web` 项目。
 * - **`bb build all`**: 启动生产构建模式，并行打包 `bundle.config.ts` 中的所有项目。
 * - **`bb dev src/script.ts`**: (内联模式) 无需配置文件，直接作为 backend 项目启动并监听。
 * - **`bb dev index.html`**: (内联模式) 自动推断为 frontend，启动本地静态服务器。
 */
````
