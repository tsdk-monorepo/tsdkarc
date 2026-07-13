# tsdkarc

**一款无装饰器、类型安全的 TypeScript 模块组合与依赖注入库。**

🇨🇳 中文 · [🇺🇸 English](https://www.google.com/search?q=./README.md) · [📖 Website](https://www.google.com/search?q=xxx) · [🎮 Demo](https://www.google.com/search?q=xxx)

---

## tsdkarc 是什么？

摆脱装饰器，`tsdkarc` 通过纯函数组合实现优雅的依赖注入（DI）。模块的上下文（Context，简称 **ctx**）类型会根据 `init()` 的返回值进行**全自动推导**，彻底告别手动声明 Token 和冗余的类型绑定。

## ✨ 核心特性

- **🛡️ 极致类型安全**：多模块组合时，`ctx` 自动合并推导，编译期拦截字段冲突。
- **🍃 零装饰器依赖**：完全摒弃 `reflect-metadata`，回归纯粹的函数式体验。
- **⚡ 原生 Tree Shaking**：无副作用设计，未使用的模块与类型工具可被打包工具干净剔除。
- **🔄 完善的生命周期**：内置多阶段 Hooks（全局/模块级），精确掌控启动与优雅停机（Graceful Shutdown）。
- **🗺️ 清晰的依赖关系**：内置依赖图分析 `graph()`，支持打印拓扑结构，彻底告别“黑盒”调试。

---

## 🚀 快速开始

**1. 安装**

```bash
npm install tsdkarc

```

**2. 基础使用**

```ts
import { defineModule } from "tsdkarc";

// 定义子模块 User
const UserModule = defineModule({ name: "user" }).init(() => {
  const users = [{ id: 1, name: "Alice" }];
  return { findUser: (id: number) => users.find((u) => u.id === id) };
});

// 定义子模块 Logger
const LoggerModule = defineModule({ name: "logger" }).init(() => ({
  log: (msg: string) => console.log(`[LOG] ${msg}`),
}));

// 组合成 App 并启动
const app = await defineModule({
  name: "app",
  modules: [UserModule, LoggerModule],
})
  .init()
  .start();

// 类型全自动推导，开箱即用
app.ctx.logger.log("started");
console.log(app.ctx.user.findUser(1)?.name); // 输出: Alice

// 优雅停机
await app.stop();
```

---

## 📚 核心概念

### 1. 模块定义与组合

通过 `defineModule` 声明模块，支持命名空间和匿名展开：

- **命名模块**：传入 `name`，返回值会被挂载到 `ctx[name]` 下。
- **匿名模块**：不传 `name`，返回值会直接平铺合并进顶层 `ctx` 中。

```ts
// 匿名模块：直接展开
const hello = defineModule().init(() => ({ greet: "hello" }));
type HelloCtx = ContextOf<typeof hello>; // { greet: string }

// 命名模块：拥有独立命名空间
const example = defineModule({ name: "example" }).init(() => ({ test: "x" }));
type ExampleCtx = ContextOf<typeof example>; // { example: { test: string } }

// 组合模块（支持 modules 数组 或 .with 链式调用）
const app = defineModule({ modules: [hello, example] }).init();
// 等价于: const app = defineModule().with(hello, example);
```

### 2. 生命周期 Hooks

`tsdkarc` 提供模块级和全局级两种生命周期钩子，支持异步操作。

**模块级钩子**（定义在 `.init()` 的第二个参数，仅影响自身）：

| 钩子名称             | Context (`ctx`) 访问权限               | 说明                 |
| -------------------- | -------------------------------------- | -------------------- |
| `beforeBoot(depCtx)` | **仅依赖 ctx**（不含本模块自身 slice） | 模块初始化前触发     |
| `afterBoot`          | 依赖 ctx + 本模块自身 slice            | 模块初始化完成后触发 |
| `beforeShutdown`     | 依赖 ctx + 本模块自身 slice            | 模块销毁前触发       |
| `shutdown`           | 依赖 ctx + 本模块自身 slice            | 执行模块核心销毁逻辑 |
| `afterShutdown`      | 依赖 ctx + 本模块自身 slice            | 模块销毁后触发       |

**全局级钩子**（定义在 `.start()` 的参数中，管理整个应用组合）：

| 钩子名称             | 触发时机              | Context (`ctx`) 状态 |
| -------------------- | --------------------- | -------------------- |
| `beforeBoot`         | 所有模块启动 **前**   | 空对象 `{}`          |
| `afterBoot`          | 所有模块启动 **后**   | 完整 `FinalCtx`      |
| `beforeEachBoot`     | 每个子模块启动 **前** | 当前累积的部分 ctx   |
| `afterEachBoot`      | 每个子模块启动 **后** | 当前累积的部分 ctx   |
| `beforeShutdown`     | 整体销毁 **前**       | 完整 `FinalCtx`      |
| `afterShutdown`      | 整体销毁 **后**       | 完整 `FinalCtx`      |
| `beforeEachShutdown` | 每个子模块销毁 **前** | 完整 `FinalCtx`      |
| `afterEachShutdown`  | 每个子模块销毁 **后** | 完整 `FinalCtx`      |

> **💡 提示**：
>
> 1. `*Each*` 系列钩子会接收第二个参数 `meta: { name: string | null; kind: "named" | "anon" }`。可通过 `meta.kind === "anon"` 判断匿名模块。
> 2. 启动过程中若发生异常，引擎会自动**按依赖倒序**回滚已启动模块的 `shutdown`，并将错误作为 `reason` 传递。

### 3. 依赖图分析

内置可视化树，便于排查复杂的依赖层级。

```ts
import { formatModuleGraph } from "tsdkarc";

console.log(formatModuleGraph(app.graph()));
// 输出示例:
// - app
//   - user
//   - logger
```

---

## 🛠 高阶技巧：命名冲突与深度合并

多个模块若暴露出相同的命名，编译期会**直接报错**以保证类型安全。如果这是预期行为，可使用 `ignoreConflicts` 显式声明允许冲突，运行时将执行**深合并（后覆盖前）**：

```ts
const dbReal = defineModule({ name: "database" }).init(() => ({
  uri: "real",
  id1: 1,
}));
const dbFake = defineModule({ name: "database" }).init(() => ({
  uri: "fake",
  id2: 2,
}));

const app = defineModule({ ignoreConflicts: ["database"] }).with(
  dbReal,
  dbFake
);

await app.start({
  afterBoot: (ctx) => console.log(ctx.database),
  // 深度合并结果: { uri: 'fake', id1: 1, id2: 2 }
});
```

---

## 📖 API 参考

### `defineModule(meta?)`

返回一个 `ModuleDeclaration` 实例。

| 参数              | 类型          | 说明                                        |
| ----------------- | ------------- | ------------------------------------------- |
| `name`            | `string`      | 可选。模块在 ctx 中的命名空间键             |
| `modules`         | `AnyModule[]` | 可选。当前模块依赖的其他模块                |
| `ignoreConflicts` | `string[]`    | 可选。允许命名冲突并执行深度合并的 key 列表 |

### 模块实例方法

| 方法                     | 说明                                           |
| ------------------------ | ---------------------------------------------- |
| `.init(bootFn?, hooks?)` | 实例化并返回 `NamedModule` 或 `AnonModule`     |
| `.with(...modules)`      | 语法糖：组合模块（等价于 `.init().with(...)`） |
| `.start(options?)`       | 启动并返回 `{ ctx, stop }`                     |
| `.graph()`               | 返回 `ModuleGraphNode` 依赖树结构数据          |

### 核心类型工具

| 类型            | 说明                                                |
| --------------- | --------------------------------------------------- |
| `ContextOf<M>`  | 获取模块启动完成后的完整 Context 类型               |
| `DepCtxOf<M>`   | 获取当前模块依赖的 Context 类型（不包含自身返回值） |
| `OwnSliceOf<M>` | 获取当前模块 `init()` 自身的返回值类型              |

---

## ❓ FAQ

**Q: 与 NestJS / InversifyJS 等基于装饰器的 DI 库有何不同？**

不需要引入 `reflect-metadata`，也没有 `@Injectable()` 等侵入式代码。`tsdkarc` 利用 TypeScript 强大的推导能力，仅通过普通函数就能让 `ctx` 类型做到全自动感知。

**Q: 遇到循环依赖会怎样？**

会在 `.start()` 的排序阶段立刻抛出异常：`[tsdkarc] Circular dependency detected at module "<name>"`。建议使用 `.graph()` 配合 `formatModuleGraph()` 进行排查。

**Q: `init()` 返回字段和已注入的依赖 ctx 冲突了怎么办？**

编译期会触发 `FindSliceCollision` 错误。⚠️ 注意，这是纯 TypeScript 静态检查，如果使用 `@ts-ignore` 绕过，运行时则会发生静默覆盖。

**Q: 多模块依赖形成了“菱形依赖”（Diamond Dependency），会重复启动吗？**

不会。`tsdkarc` 会对模块对象的引用进行拓扑排序并去重（不以 `name` 为基准）。同一模块即使被多条路径依赖，也**只会启动一次**，并确保排在所有依赖它的模块之前。

**Q: 匿名模块字段冲突了会怎样？**

运行时会抛出 `[tsdkarc] Anonymous module slice collision` 异常，除非该字段被显式加入了 `ignoreConflicts`。

**Q: `ignoreConflicts` 的深合并策略是怎样的？**

仅当两边都是**纯对象**（Plain Object，排除数组/`Date`/`Map`/实例对象等）时才会递归合并。非纯对象时，后者整体覆盖前者，数组不会被拼接。安全起见，引擎会始终跳过对 `__proto__` 和 `prototype` 的合并。

---

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

代码仓库目录结构说明：

```text
tsdkarc/       # 核心库代码
tsdkarc-x/     # 官方扩充生态：端到端类型安全开发框架
tsdkbundle/    # 监测与打包应用工具
website/       # 文档网站

```

## 📜 协议与更新日志

- 更新日志详见 [CHANGELOG.md](./CHANGELOG.md)。
- 基于 [MIT](./LICENSE) 协议开源。
