# tsdkarc

> **无装饰器、类型安全的 TypeScript 模块组合与依赖注入库**

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)

🇨🇳 中文 · [🇺🇸 English](./README.md)

不用装饰器，不用 `reflect-metadata`。`ctx` 类型完全由每个模块 `init()` 的返回值在编译期自动推导。

```ts
import { defineModule, type ContextOf } from "tsdkarc";

const LoggerModule = defineModule().init(() => {
  console.log("[LOG] init LoggerModule"); // Only log once: [LOG] init LoggerModule
  return {
    logger: {
      log: (message: string) => console.log(`[LOG] ${message}`),
    },
  };
});
type ILogger = ContextOf<typeof LoggerModule>["logger"];

class UserService {
  constructor(private logger: ILogger) {}
  createUser(name: string) {
    this.logger.log(`Creating user: ${name}`);
  }
}

const UserServiceModule = defineModule({
  name: "userService",
  modules: [LoggerModule],
}).init((ctx) => new UserService(ctx.logger));

const app = await defineModule({ modules: [UserServiceModule, LoggerModule] })
  .init((ctx) => {
    ctx.logger.log("The application is running..."); // [LOG] The application is running...
  })
  .start();
app.ctx.userService.createUser("Alice"); // [LOG] Creating user: Alice
await app.stop();
```

---

## 核心理念：模块是可复用的积木

DI 不是重点，**可组合性**才是。一个模块的契约完全由它声明：`modules` 是输入，`init()` 的返回值是输出。它不知道自己会被装进哪个 app，因此可以被跨项目复用、独立发布、整体替换、或嵌套组合成更大的模块。

```ts
// logger-module/index.ts —— 独立发布，不知道任何 app 的存在
export const LoggerModule = defineModule({ name: "logger" }).init(() => ({
  log: (message: string) => console.log(`[LOG] ${message}`),
}));

// 不同 app 复用同一个模块，ctx 类型依然完整
const appA = await defineModule({ modules: [LoggerModule, OrderModule] })
  .init()
  .start();
const appB = await defineModule({ modules: [LoggerModule, ReportModule] })
  .init()
  .start();
```

---

## 特性

- **零装饰器**，摆脱 `reflect-metadata`
- **自动类型推导**：`ctx` 由 `init()` 返回值结构化推导，无需 token
- **编译期冲突检测**：字段重名在类型检查阶段就会报错
- **原生 Tree Shaking**：无副作用设计
- **完整生命周期钩子**：模块级 + 全局级，启动失败自动按依赖倒序回滚
- **依赖图可视化**：`graph()` + `formatModuleGraph()`
- **菱形依赖安全**：按引用去重，共享模块只启动一次

---

## 安装

```bash
npm install tsdkarc
```

无需 transformer、无需 `ts-patch`，纯 `tsc`/打包器即可运行。

---

## 模块定义与组合

```ts
// 匿名模块：返回值直接铺平进父级 ctx
const hello = defineModule().init(() => ({ greet: "hello" }));
type HelloCtx = ContextOf<typeof hello>; // { greet: string }

// 命名模块：返回值挂载到 ctx[name] 下
const example = defineModule({ name: "example" }).init(() => ({ test: "x" }));
type ExampleCtx = ContextOf<typeof example>; // { example: { test: string } }
```

`init(ctx)` 收到的 `ctx` 只包含**依赖**的 context，不含自身 slice —— 这也是循环自引用在结构上不可能发生的原因。诸如环境变量、密钥等非模块值，直接在 `init()` 内闭包获取即可，无需额外的“显式映射”API：

```ts
const ConfigModule = defineModule({ name: "config" }).init(() => ({
  apiKey: process.env.API_KEY!,
}));
```

**菱形依赖**：`LoggerModule` 若被多条路径依赖，tsdkarc 按模块引用（而非 `name`）去重，只启动一次，且排在所有依赖它的模块之前。

---

## 生命周期钩子

**模块级**（`.init()` 第二参数，仅影响自身）：`beforeBoot` `afterBoot` `beforeShutdown` `shutdown` `afterShutdown`

**全局级**（`.start()` 参数，管理整个组合）：`beforeBoot` `afterBoot` `beforeEachBoot` `afterEachBoot` `beforeShutdown` `afterShutdown` `beforeEachShutdown` `afterEachShutdown`

`*Each*` 钩子额外接收 `meta: { name: string | null; kind: "named" | "anon" }`。启动失败时，已启动模块会按依赖倒序自动回滚 `shutdown`，无需手动清理。

---

## 依赖图

```ts
console.log(app.graph().formatted);
// - app
//   - userService
//     - logger
```

排查 `[tsdkarc] Circular dependency detected at module "<name>"` 的第一入口。

---

## API 参考

**`defineModule(meta?)`** → `ModuleDeclaration`

| 参数              | 类型          | 说明                         |
| ----------------- | ------------- | ---------------------------- |
| `name`            | `string`      | 可选，ctx 命名空间键         |
| `modules`         | `AnyModule[]` | 可选，依赖的其他模块         |
| `ignoreConflicts` | `string[]`    | 可选，允许冲突并深合并的 key |

**模块实例方法**：`.init(bootFn?, hooks?)` `.with(...modules)` `.start(options?)` `.graph()`

**类型工具**：`ContextOf<M>` 完整 ctx 类型 · `DepCtxOf<M>` 依赖 ctx 类型（不含自身） · `OwnSliceOf<M>` 自身 `init()` 返回类型

---

## ❓ FAQ

**Q: 与 NestJS / InversifyJS 等基于装饰器的 DI 库有何不同？**

不需要引入 `reflect-metadata`，也没有 `@Injectable()` 等侵入式代码。`tsdkarc` 利用 TypeScript 强大的推导能力，仅通过普通函数就能让 `ctx` 类型做到全自动感知。

**Q: 遇到循环依赖会怎样？**

会在 `.start()` 的排序阶段立刻抛出异常：`[tsdkarc] Circular dependency detected at module "<name>"`。可以配合打印 `.graph().formatted` 进行排查。

**Q: `init()` 返回字段和已注入的依赖 ctx 冲突了怎么办？**

编译期会触发 `FindSliceCollision` 错误。⚠️ 注意，这是纯 TypeScript 静态检查，如果使用 `@ts-ignore` 绕过，运行时则会发生静默覆盖。

**Q: 多模块依赖形成了“菱形依赖”（Diamond Dependency），会重复启动吗？**

不会。`tsdkarc` 会对模块对象的引用进行拓扑排序并去重（不以 `name` 为基准）。同一模块即使被多条路径依赖，也**只会启动一次**，并确保排在所有依赖它的模块之前。

**Q: 匿名模块字段冲突了会怎样？**

运行时会抛出 `[tsdkarc] Anonymous module slice collision` 异常，除非该字段被显式加入了 `ignoreConflicts`。

**Q: `ignoreConflicts` 的深合并策略是怎样的？**

仅当两边都是**纯对象**（Plain Object，排除数组/`Date`/`Map`/实例对象等）时才会递归合并。非纯对象时，后者整体覆盖前者，数组不会被拼接。安全起见，引擎会始终跳过对 `__proto__` 和 `prototype` 的合并。

---

## 仓库结构

```text
tsdkarc/       # 核心库
tsdkarc-x/     # 官方扩充生态
tsdkbundle/    # 监测与打包工具
website/       # 文档网站
```

---

## 其他

[MIT](./LICENSE)

[CHANGELOG.md](./CHANGELOG.md)
