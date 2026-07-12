# tsdkarc

这是一个无需依赖装饰器注入的、类型安全且支持模块组合的 TypeScript 库。

[![NPM Version](https://badgen.net/npm/v/tsdkarc?color=green)](https://www.npmjs.com/package/tsdkarc)
![NPM Weekly Downloads](https://img.shields.io/npm/dw/tsdkarc)
![NPM Month Downloads](https://img.shields.io/npm/dm/tsdkarc.svg?style=flat)
![typescript](https://badgen.net/badge/icon/typescript?icon=typescript&label&color=blue)
[![jsDocs.io](https://img.shields.io/badge/jsDocs.io-reference-blue)](https://www.jsdocs.io/package/tsdkarc)

🇨🇳 中文 · [🇺🇸 English](./README.md) · [📖 Website](xxx) · [🎮 Demo](xxx)

---

# 💡 tsdkarc 是什么

tsdkarc 是一个无需依赖装饰器注入的、类型安全且支持模块组合的 TypeScript 库。

---

# 🤔 为什么选择它

相比 装饰器依赖注入：

- tsdkarc 使用普通 js 语法，无需 polyfill。

相比其他传统方案：

- tsdkarc 更专注轻量级和类型安全模块组合，提供开箱即用语法。

---

# ✨ 特性

- 🚀 多模块类型安全组合
- 🔄 不需要装饰器注入
- 🛡️ 简单但强大的语法
- 📦 轻量设计：支持 Tree Shaking
- 🔧 TypeScript：提供完整类型支持

---

# ⚡ 快速开始

## 安装

```bash
npm install tsdkarc
```

## 使用

```ts
import { defineModule } from "tsdkarc";

const UserModule = defineModule({
  name: "user", // Namespace but optional
}).init(() => {
  const users = [{ id: 1, name: "Alice" }];
  return {
    findUser(id: number) {
      return users.find((user) => user.id === id);
    },
  };
});

const LoggerModule = defineModule({
  name: "logger",
}).init(() => ({
  log(message: string) {
    console.log(message);
  },
}));

const App = defineModule({ modules: [UserModule, LoggerModule] }).init();
const app = await App.start();

app.ctx.logger.log("Application started");

const user = app.ctx.user.findUser(1);
console.log(user?.name);
```

---

# 📚 示例

展示真实业务使用方式。

## 定义模块

```tsx
import { defineModule, type ContextOf } from "tsdkarc";

const hello = defineModule().init(() => {
  return { greet: "hello" };
});

const name = defineModule().init(() => {
  return { name: "tsdkarc" };
});

type HelloCtx = ContextOf<typeof hello>; // {greet: string}
type NameCtx = ContextOf<typeof name>; // {name: string}

// 命名空间
const namespaceExample = defineModule({ name: "example" }).init(() => {
  return { test: "this is a test for namespace" };
});
type NamespaceExampleCtx = ContextOf<typeof namespaceExample>; // {example: {test: string}}
```

## 组合模块并运行

组合模块有两种方式。

第一种，使用 `modules` 参数：

```ts
const combined = defineModule({ modules: [hello, name] }).init();
const app = await combined.start({
  afterBoot: ({ greet, name }) => {
    console.log(`${greet}, ${name}!`);
  },
});

// 获取模块ctx类型
type CombinedCtx = ContextOf<typeof combined>;

// 停止运行
app.stop();
```

第二种使用 `.with` 语法：

```ts
const combined2 = defineModule()
  .with(greet, name);
  .start(({ greet, name }) => {
    console.log(`${greet}, ${name}!`);
  });


const app2 = combined2.start({
  afterBoot: ({ greet, name }) => {
    console.log(`${greet}, ${name}!`);
  },
});

// 停止运行
app2.stop()
```

### 生命周期

有两处地方可以放入模块生命周期钩子，第一处 `.init`：

```ts
.init(({}) = ctx, {
  beforeBoot?: (ctx: Record<never, never>) => any;
  afterBoot?: (ctx: FinalCtx) => any;
  beforeShutdown?: (ctx: FinalCtx, reason?: Reason) => any;
  afterShutdown?: (ctx: FinalCtx, reason?: Reason) => any;
  beforeEachBoot?: (ctx: object, module: ModuleMeta) => any;
  afterEachBoot?: (ctx: object, module: ModuleMeta) => any;
  beforeEachShutdown?: (
    ctx: object,
    module: ModuleMeta,
    reason?: Reason
  ) => any;
  afterEachShutdown?: (ctx: object, module: ModuleMeta, reason?: Reason) => any;
})
```

另外一个地方是启动的时候 `.start`：

```ts
.start({
  beforeBoot?: (ctx: Record<never, never>) => any;
  afterBoot?: (ctx: FinalCtx) => any;
  beforeShutdown?: (ctx: FinalCtx, reason?: Reason) => any;
  afterShutdown?: (ctx: FinalCtx, reason?: Reason) => any;
  beforeEachBoot?: (ctx: object, module: ModuleMeta) => any;
  afterEachBoot?: (ctx: object, module: ModuleMeta) => any;
  beforeEachShutdown?: (
    ctx: object,
    module: ModuleMeta,
    reason?: Reason
  ) => any;
  afterEachShutdown?: (ctx: object, module: ModuleMeta, reason?: Reason) => any;
})
```

到目前为止，我们已经可以定义模块，可选模块命名空间，获取该模块上下文类型（Ctx or Context），模块组合，生命周期，启动运行以及停止运行模块。

## 高级用法

### 1. 如果组合的多个模块，上下文(Context)冲突怎么办？

如果属性冲突，组合的时候会报类型错误：

`Error: Duplicate module name 'example' detected in array.`

```ts
const module1 = defineModule({ name: "example" }).init(() => {
  return { test: "this is a test for namespace" };
});
const module2 = defineModule({ name: "example" }).init(() => {
  return { test2: "this is a test for namespace" };
});

defineModule({ modules: [module1, module2] }); // Error: Duplicate module name 'example' detected in array.
```

或者使用 `.with` 语法报错： `Expected 1 arguments, but got 2`

```ts
const module1 = defineModule({ name: "example" }).init(() => {
  return { test: "this is a test for namespace" };
});
const module2 = defineModule({ name: "example" }).init(() => {
  return { test2: "this is a test for namespace" };
});

defineModule().with(module1, module2); // Expected 1 arguments, but got 2
```

**如何解决这种情况？** 使用 `ignoreConflicts` 参数：

```ts
const module1 = defineModule({ name: "example" }).init(() => {
  return { test: "this is a test for namespace" };
});
const module2 = defineModule({ name: "example" }).init(() => {
  return { test2: "this is a test for namespace" };
});

defineModule({ ignoreConflicts: ["example"] }).with(module1, module2);
```

利用 `ignoreConflicts` 特性合并模块属性，按照执行顺序，后面模块属性覆盖前面模块的：

```ts
const database = defineModule({ name: "database" }).init(() => {
  return { uri: "real database URI", id1: 1 };
});
const fakeDatabase = defineModule({ name: "database" }).init(() => {
  return { uri: "fakedatabse URI", id2: 2 };
});

const app = defineModule({ ignoreConflicts: ["database"] }).with(
  database,
  fakeDatabase
);

await app.start({
  afterBoot(ctx) {
    console.log(ctx); // { database: { uri: 'fakedatabse URI', id1: 1, id2: 2 } }
  },
});
```

## 常见问题

## 支持的运行环境

tsdkarc 支持运行在任何能跑 JavaScript 语法的环境，比如：

- Node.js
- 浏览器环境
- Bun
- Deno
- 其他 JS 运行环境

---

# 📖 API

核心 API：

## `defineModule()`

```
defineModule({

})
.init()
.with()
.start().then(result => {
  result.ctx;
  result.stop();
})
```

用途：定义，组合，运行，停止模块

参数：

返回：

示例：

```ts
import { defineModule } from "tsdkarc";

// 定义简单模块
const hello = defineModule().init(() => {
  return { greet: "hello" };
});
const world = defineModule().init(() => {
  return { msg: "world" };
});

// 组合模块
const awesome = defineModule({ modules: [hello, world] }).init((ctx) => {
  // 访问其他模块信息
  console.log(ctx.greet, ctx.msg);
});

// 运行模块
const instance = await awesome.start();

// 停止运行模块
instance.stop();
```

## `ContextOf<T>`

用途：获取模块的上下文类型，可以是单独模块，也可以是组合模块

使用实例：

```ts
import { defineModule, type ContextOf } from "tsdkarc";

const hello = defineModule().init(() => {
  return { greet: "hello" };
});

type HelloCtx = ContextOf<typeof hello>; // {greet: string}
```

---

## 配置项

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| xxx  | xxx  | xxx    | xxx  |

完整文档：

[Documentation](xxx)

---

# 🌍 兼容性

支持：

- Node.js：
- 浏览器：
- TypeScript：
- React / Vue / 其他：

---

# ❓ 常见问题

## 这个和装饰器依赖注入方案比较有什么优缺点？

tsdkarc 方案更加轻量级，开箱即用。来一个对比。

传统装饰器注入：

```ts
@Injectable()
class UserService {
  getUser() {
    return "user";
  }
}

@Injectable()
class UserController {
  constructor(private userService: UserService) {}

  hello() {
    return this.userService.getUser();
  }
}

const controller = container.resolve(UserController);

console.log(controller.hello());
```

使用 `tsdkarc`:

```ts
import { defineModule, type ContextOf } from "tsdkarc";

const userService = defineModule().init(() => ({
  getUser() {
    return "user";
  },
}));

const userController = defineModule({ modules: [userService] }).init((ctx) => ({
  hello() {
    return ctx.getUser();
  },
}));

type ControllerCtx = ContextOf<typeof userController>;

const { ctx, stop } = await userController.start();
console.log(ctx.hello());
```

---

# 🛠️ Contributing

欢迎提交 Issue 和 Pull Request。

本地开发：

```bash
git clone xxx

cd xxx

pnpm install

pnpm dev
```

项目结构：

```text
tsdkarc/
tsdkarc-x/
tsdkbundle/
website/
```

---

# 📝 Changelog

版本更新记录：

[CHANGELOG.md](./CHANGELOG.md)

---

# 📄 License

MIT
