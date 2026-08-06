# tsdkbundle: A Bun-Based TypeScript Multi-Entry Bundler

2026-08-06

Modern TypeScript backend projects often contain more than one entry point.

Besides HTTP API services, a project may include workers, scheduled tasks, CLI tools, database migration scripts, and other standalone modules.

Managing each entry separately usually means maintaining multiple startup scripts, watch processes, and build configurations. As the project grows, these configurations become repetitive and harder to maintain.

[`tsdkbundle`](https://github.com/tsdk-monorepo/tsdkarc/blob/main/tsdkbundle) was created to simplify this workflow.

It is a Bun-based ESM bundler and watcher designed for TypeScript multi-entry projects:

- Manage multiple entry points with a single configuration file
- Watch files and restart processes during development
- Build multiple entries consistently for production
- Native support for ESM and TypeScript (Otherwise `@nestjs/cli` is good for commonjs projects)
- Fast builds powered by Bun

For example, a backend project:

```text
src/
├── index.ts              # API service
├── worker.ts             # Async worker
└── scripts/
    └── migrate.ts        # Database migration
```

Configure the project:

```ts
export default {
  projects: {
    backend: {
      target: "node",
      entry: ["src/index.ts", "src/worker.ts", "src/scripts/migrate.ts"],
    },
  },
};
```

Run in development mode:

```bash
bundle dev backend
```

Build for production:

```bash
bundle build backend
```

---

## Why Bun?

Bun already provides TypeScript support, ESM support, and a fast bundler.

However, application projects still need to handle common tasks such as:

- Managing multiple entry points
- Running development processes
- Watching source files
- Restarting services after changes
- Building multiple projects together

`tsdkbundle` focuses on simplifying these workflows.

It does not replace Bun. It provides a project-level workflow on top of Bun for TypeScript applications.

---

## Use Cases

`tsdkbundle` is designed for:

- TypeScript backend projects
- Node.js services
- Applications with multiple runtime entry points

It is not intended to replace frontend tools like Vite or Next.js. Instead, it focuses on a specific problem:

> Making multi-entry development, execution, and building for TypeScript projects easier.

As the ecosystem moves toward ESM, TypeScript, and Bun, development workflows need tools that fit these environments.

`tsdkbundle` aims to be a simple and focused tool for managing TypeScript multi-entry projects.

Check it today 👉 https://github.com/tsdk-monorepo/tsdkarc/blob/main/tsdkbundle
