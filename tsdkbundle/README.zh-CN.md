# tsdkbundle

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)

🇨🇳 中文 · [🇺🇸 English](./README.md)

一个基于 Bun 构建的 ESM 多入口开发监测与打包工具。

## 🚀 快速开始

### 1. 安装

> 确保系统已安装 [Bun](https://bun.sh/)

```bash
npm install -g tsdkbundle
```

### 2. 初始化配置

在 ts 项目根目录创建 `bundle.config.ts`：

```ts
// bundle.config.ts
import type { BundleConfigFn, BundleConfig } from "tsdkbundle";

export default (({ command }): BundleConfig => {
  const isProd = command === "build";

  return {
    default: ["backend"],
    projects: {
      backend: {
        target: "node",

        // 1. 定义需要独立编译的所有入口文件
        entry: [
          "src/index.ts", // HTTP API 入口
          "src/worker.ts", // 异步任务 Worker 入口
          "src/scripts/migrate.ts", // 数据库迁移脚本
        ],

        // 2. 指定在开发模式 (dev) 下，自动启动哪个文件作为主进程
        // 若未指定，则默认 entry[0]
        main: "src/index.ts",

        outdir: "dist",
        sourcemap: isProd ? "none" : "linked",
        minify: isProd,
      },
    },
  };
}) satisfies BundleConfigFn;
```

```
project-root/
├── bundle.config.ts         # ★ 构建编排中心 (tsdkbundle)
├── package.json
├── tsconfig.json
├── .env                     # 本地环境变量 (被 bundle.config 引用)
├── dist/                    # 编译产出目录 (被 bundle.config 的 outdir 指定，由工具生成)
│
└── src/
    ├── index.ts             # ★ 主入口 (被 bundle.config 的 entry 指定)
    ├── app.ts               # Web 框架实例 (Express/Koa)，供 index.ts 调用
    ├── config/              # 业务配置 (如读取 process.env 暴露给其他模块)
    ├── middlewares/         # 全局中间件
    ├── utils/               # 全局工具类
    │
    └── modules/             # 领域驱动的业务子模块
        └── users/
            ├── user.route.ts
            ├── user.controller.ts
            ├── user.service.ts
            └── user.model.ts
```

### 3. 运行命令

```bash
# 开发模式 (自动监测文件改动并重启)
bundle dev             # 运行 default 配置的项目
bundle dev backend     # 仅运行名为 backend 的项目

# 生产打包
bundle build           # 打包 default 配置的项目
bundle build backend   # 仅打包名为 backend 的项目
```

_(注：如果命令与 Ruby 的 bundle 冲突，请使用 `bb dev`)_

## 💡 进阶示例

### 自定义 tsconfig 与排除外部模块

在构建 Node.js 后端时，通常不需要将 `pg`、`bcrypt` 等原生模块打包进去。

```ts
// bundle.config.ts
export default (): BundleConfig => {
  return {
    projects: {
      api: {
        target: "node",
        entry: ["src/api.ts"],
        tsconfig: "./tsconfig.server.json", // 指定特定的 tsconfig
        external: ["pg", "bcrypt", "cors"], // 标记为外部模块，不进行打包
      },
    },
  };
};
```

## ⚙️ `BundleConfig` 参数定义

```ts
/** 单个项目的配置块 */
export interface ProjectConfig {
  /** Bun 构建目标，默认为 "node"，前端需要使用 "browser" */
  target?: "bun" | "browser" | "node";

  /** 入口文件。支持字符串或字符串数组 */
  entry: string | string[];

  /**
   * 在 dev 模式下作为主进程启动的入口文件 (仅限后端)。
   * 如果未指定，默认为 entry 数组的第一个文件。
   */
  main?: string;

  /** 当前项目的 tsconfig.json 路径。默认为 "tsconfig.json" */
  tsconfig?: string;

  /** 输出目录。默认为 "dist/<projectName>" */
  outdir?: string;

  /** 启动进程前加载的 .env 文件 */
  envFile?: string;

  /** 标记为外部依赖的包 (不参与打包) */
  external?: string[];

  /** Sourcemap 模式。dev 默认 "linked"，build 默认 "none" */
  sourcemap?: SourcemapMode;

  /** 是否压缩代码。默认为 false */
  minify?: boolean;

  /** 额外需要监测变动的目录 */
  watchDirs?: string[];

  /** 忽略监测的文件或目录 */
  ignore?: string[];

  /** 在构建阶段应用的 Bun 原生插件。例如: [yamlPlugin()] */
  plugins?: BunPlugin[];

  /** 启动开发进程或前端服务器时，设置 process.env.PORT */
  port?: number | string;
}

/** bundle.config.ts 的根配置结构 */
export interface BundleConfig {
  projects: Record<string, ProjectConfig>;
  /** 默认执行的项目列表 */
  default?: string[];
}
```

## 常见问题 FAQ

**1. 为什么创建这个项目？**

在基于 TS 的后端开发中，子模块独立打包、多入口 watch 监测运行是刚需。以往我们用 `nodemon`，后来有仅支持 CommonJS 的 `nestjs/cli`。随着 ESM 成为主流，我们需要一个类似 `nestjs/cli` 但完美支持 ESM 的工具。Bun 速度极快且体验优秀，因此基于它构建了本工具。

**2. 为什么不直接使用 bun 而是包了一层？**

Bun 本身已提供丰富的 watch 和打包功能，但对于**多入口项目的自动化监测运行和批量打包**，原生命令拼凑起来比较繁琐，本工具旨在一步到位解决这个痛点。

**3. 和 nestjs/cli 有什么区别？**

`nestjs/cli` 是一款优秀的工具，但目前对 ESM 模块的支持不够理想，本项目原生拥抱 ESM。

**4. 支持前端项目吗？**

支持将前端代码作为入口进行打包，但不包含 HMR (热更新) 等重度前端开发特性。对于大型前端项目，推荐使用 Vite 或 Next.js。本项目现阶段主要针对后端 TS 项目。
