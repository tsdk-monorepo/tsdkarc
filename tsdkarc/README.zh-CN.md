# tsdkarc

🇨🇳 中文 · [🇺🇸 English](./README.md)

## 介绍

tsdkarc 是一个用于 TypeScript 的模块组合与依赖注入（DI）库。

它的核心设计是不使用任何装饰器，也不依赖 `reflect-metadata`。模块的上下文（`ctx`）完全在编译时通过每个模块 `init()` 方法的返回值进行结构化推导。运行产物为纯 JavaScript 代码，不需要额外的 AST 转换工具或特殊的编译配置。

## 解决了什么痛点

1. **消除运行时的“黑魔法”与开销**：传统 DI 强依赖装饰器和反射，容易造成打包体积大、摇树优化（Tree-shaking）失效。**tsdkarc** 通过纯函数调用实现，对现代构建工具完全透明。
2. **提前暴露依赖错误**：以往缺少依赖或 Token 拼写错误通常在应用启动后才会报错。**tsdkarc** 将依赖图的校验前置到了 TS 编译期，上下文类型不匹配会直接导致类型检查不通过。
3. **隐式处理菱形依赖**：在复杂的模块化项目中，多个业务线可能同时依赖同一个底层模块（如日志、配置）。**tsdkarc** 会在底层根据对象引用进行拓扑排序和去重，保证共享依赖按正确顺序且仅启动一次。
4. **可靠的资源清理**：自带全局和模块级别的生命周期管理，启动过程中任意节点报错，会自动按照依赖的逆序执行已启动模块的销毁逻辑。

## 快速运行

**安装**

直接通过 npm 安装，运行在常规的 `tsc` 或打包工具上即可：

```bash
npm install tsdkarc

```

**基础使用**

定义模块并显式组装：

```ts
import { defineModule, type ContextOf } from "tsdkarc";

// 1. 定义底层模块
const LoggerModule = defineModule().init(() => {
  return {
    logger: {
      log: (message: string) => console.log(`[LOG] ${message}`),
    },
  };
});

// 提取推导出的类型供外部使用
type ILogger = ContextOf<typeof LoggerModule>["logger"];

class UserService {
  constructor(private logger: ILogger) {}
  createUser(name: string) {
    this.logger.log(`Creating user: ${name}`);
  }
}

// 2. 定义业务模块并声明依赖
const UserServiceModule = defineModule({
  name: "userService",
  modules: [LoggerModule],
}).init((ctx) => new UserService(ctx.logger));

// 3. 组装并启动应用
const app = await defineModule({ modules: [UserServiceModule, LoggerModule] })
  .init((ctx) => {
    ctx.logger.log("Application started");
  })
  .start();
app.ctx.userService.createUser("Alice");
await app.stop();
```

## 常用示例

### 命名模块与匿名模块

匿名模块的返回值会被平铺合并到父级；命名模块则会挂载到以 `name` 为键的命名空间下。

```ts
// 匿名模块
const hello = defineModule().init(() => ({ greet: "hello" }));
// ctx 推导为: { greet: string }

// 命名模块
const example = defineModule({ name: "example" }).init(() => ({ test: "x" }));
// ctx 推导为: { example: { test: string } }
```

### 注入非模块变量（如环境变量）

不需要专门的注入 API，直接在 `init` 的闭包中获取即可：

```ts
const ConfigModule = defineModule({ name: "config" }).init(() => ({
  apiKey: process.env.API_KEY!,
}));
```

### 查看依赖树

在排查依赖问题时，可直接打印格式化后的依赖关系图：

```ts
console.log(app.graph().formatted);
/* 
- app
  - userService
    - logger 
*/
```

## FAQ

**发生循环依赖时会怎样？**

`.start()` 会在启动前的排序阶段直接抛出错误：`[tsdkarc] Circular dependency detected at module "<name>"`。可以通过打印 `.graph()` 来定位循环链路。

**模块暴露的字段名和依赖的字段名冲突了会怎样？**

会在编译阶段触发 `FindSliceCollision` 类型错误。注意，如果使用 `@ts-ignore` 强行绕过，运行时后加载的模块会覆盖前者。

**匿名模块之间发生了字段名冲突怎么办？**

运行时会抛出 `[tsdkarc] Anonymous module slice collision` 错误。如果确实需要合并同名字段，可以在定义时通过 `ignoreConflicts` 数组显式声明。

**声明在 ignoreConflicts 中的字段是如何合并的？**

仅当冲突双方都是普通对象（Plain objects）时，才会进行深层级覆盖合并。数组、`Date` 对象、`Map` 或类实例会直接被整体替换。

**tsdkarc-x 和 tsdkarc 什么关系？**

tsdkarc-x 依赖 tsdkarc 的核心特性，而且[`tsdkarc-x`](https://npmjs.com/package/tsdkarc-x) 是一款基于 tsdkarc 特性开发的后端到前端（端到端）类型安全开发库。

## API 参考

### `defineModule(meta?)`

用于声明一个模块，返回 `ModuleDeclaration` 对象。

| 参数              | 类型          | 描述                                           |
| ----------------- | ------------- | ---------------------------------------------- |
| `name`            | `string`      | 可选。指定该模块在上下文中的挂载节点名称。     |
| `modules`         | `AnyModule[]` | 可选。声明当前模块需要依赖的其他模块。         |
| `ignoreConflicts` | `string[]`    | 可选。声明允许发生冲突并执行深合并的键名列表。 |

### 实例方法

- `.init(bootFn?, hooks?)`: 定义模块的初始化逻辑与生命周期钩子（如 `beforeBoot`, `shutdown` 等）。
- `.with(...modules)`: 动态追加依赖模块。
- `.start(options?)`: 启动整个模块树，可传入全局生命周期钩子。
- `.stop()`: 按照依赖的逆序关闭所有模块。
- `.graph()`: 返回模块的依赖树数据及格式化输出。

### 类型工具

- `ContextOf<M>`: 提取模块完整的上下文类型。
- `DepCtxOf<M>`: 提取模块所依赖的上下文类型（不含自身）。
- `OwnSliceOf<M>`: 提取模块自身 `init()` 返回值的类型。

## 目前谁在使用 tsdkarc？

- [tsdkarc-x](https://github.com/tsdk-monorepo/tsdkarc/blob/main/tsdkarc-x/README.zh-CN.md) 是一款基于 tsdkarc 构建的端到端类型安全 RPC 框架。通过它，你可以在服务端定义路由后，让前端客户端自动获取对应的请求类型、调用方法以及 React/Vue Hooks。支持 Next.js、Express、Hono、Deno、Cloudflare Workers、Browser Service Workers 等环境。
