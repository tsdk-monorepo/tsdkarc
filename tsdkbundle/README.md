# tsdkbundle (bb) 🚀

A tool that watches your files and builds your apps automatically.

---

## 💡 Configuration Cheatsheet

### Core Structures

- **`BundleConfig` (Static)**: A direct configuration object.
- **`BundleConfigFn` (Dynamic)**: A callback function that receives `ctx: { command: "dev" | "build" }`, allowing you to adjust settings based on the environment.

### Root Options

| Property   | Type                            | Description                                                                                       |
| :--------- | :------------------------------ | :------------------------------------------------------------------------------------------------ |
| `default`  | `string[]`                      | _(Optional)_ The list of project names to launch when no specific projects are passed to the CLI. |
| `projects` | `Record<string, ProjectConfig>` | A dictionary defining your individual project configurations.                                     |

---

## 🛠 Project Configuration (`ProjectConfig`)

| Property    | Type                                           | Description                                                                                            |
| :---------- | :--------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `type`      | `"backend" \| "frontend"`                      | Determines the default `target` and whether `dev` mode spawns a process or starts a static server.     |
| `target`    | `"bun" \| "browser" \| "node"`                 | Compilation target. (Defaults: `backend` -> `bun`, `frontend` -> `browser`).                           |
| `entry`     | `string \| string[]`                           | Entry file(s) for compilation. Supports multiple entries.                                              |
| `main`      | `string`                                       | _(Backend only)_ The process entry point for `dev` mode. Defaults to the compiled result of `entry`.   |
| `outdir`    | `string`                                       | Output directory. Defaults to `dist/<projectName>`.                                                    |
| `envFile`   | `string`                                       | Path to your `.env` file. Automatically merged into `process.env` (supports `export` syntax).          |
| `port`      | `number`                                       | Injected as `process.env.PORT` for backends; used as the dev server port for frontends.                |
| `external`  | `string[]`                                     | Third-party dependencies to exclude from bundling. **Native node modules are excluded automatically.** |
| `sourcemap` | `"none" \| "inline" \| "linked" \| "external"` | Source map generation strategy.                                                                        |
| `minify`    | `boolean`                                      | Whether to compress the output code.                                                                   |
| `watchDirs` | `string[]`                                     | Additional directories to watch in `dev` mode (e.g., HTML templates, SQL files).                       |
| `plugins`   | `BunPlugin[]`                                  | Array of native Bun plugins (e.g., YAML, CSS preprocessors).                                           |

---

## 📖 Examples

### 1. Basic Full-Stack Setup (Static Config)

A common scenario featuring a Backend API and a React/Vue SPA.

```typescript
import type { BundleConfig } from "tsdkbundle";

export default {
  default: ["api", "web"],
  projects: {
    api: {
      type: "backend",
      entry: "src/api/index.ts",
      envFile: ".env",
      port: 3000,
      external: ["pg", "bcrypt"], // Exclude C++ extensions
    },
    web: {
      type: "frontend",
      entry: "src/web/index.tsx",
      port: 8080, // Static server port in dev mode
    },
  },
} satisfies BundleConfig;
```

### 2. Advanced Environment Logic (Dynamic Config)

Dynamically toggle minification and source maps based on the CLI command.

```typescript
import type { BundleConfigFn } from "tsdkbundle";
import yamlPlugin from "bun-plugin-yaml";

export default (({ command }) => {
  const isProd = command === "build";

  return {
    projects: {
      worker: {
        type: "backend",
        entry: ["src/worker.ts"],
        minify: isProd,
        sourcemap: isProd ? "none" : "linked",
        plugins: [yamlPlugin()], // Use native Bun plugins
      },
    },
  };
}) satisfies BundleConfigFn;
```

---

## 💻 CLI Command Reference

| Command                    | Action                                                                                       |
| :------------------------- | :------------------------------------------------------------------------------------------- |
| **`bb dev`**               | Starts all projects in the `default` list (Conflict check -> Parallel build -> Watch & Run). |
| **`bb dev api web`**       | Starts only the `api` and `web` projects.                                                    |
| **`bb build all`**         | Triggers production builds for all projects defined in `bundle.config.ts`.                   |
| **`bb dev src/script.ts`** | **Inline Mode**: Launches the file as a backend project with auto-watch, no config needed.   |
| **`bb dev index.html`**    | **Inline Mode**: Infers a frontend project and starts a local static server.                 |
