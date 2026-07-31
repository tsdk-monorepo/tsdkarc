# tsdkarc

🇨🇳 中文 · [🇺🇸 English](./README.md)

> **无装饰器、完全类型安全的 TypeScript 模块组合与依赖注入库。**

摆脱 `reflect-metadata` 与侵入式装饰器。`ctx` 的类型完全由每个模块 `init()` 的返回值在编译期自动推导。

---

## ✨ 核心特性

- **零装饰器**：无需 Token 或 `@Injectable`，纯原生 TypeScript 函数。
- **极致类型推导**：按引用自动推导合并后的上下文（`ctx`）类型。
- **编译期冲突检测**：模块命名或导出字段发生冲突时，TS 编译直接报错。
- **安全依赖管理**：自动解决菱形依赖（单例启动），运行时精准阻断循环依赖。
- **优雅降级回滚**：支持完整的生命周期，启动失败自动按依赖倒序回滚。
- **原生 Tree Shaking**：无副作用设计，完美兼容各类打包器。

---

## 🚀 快速开始

```bash
npm install tsdkarc@next

```

无需 transformer 或 `ts-patch`，直接在常规 TS 环境中使用：

```ts
import { defineModule } from "tsdkarc";

// 1. 数据层 (模拟数据库，带生命周期)
const DbModule = defineModule({ name: "db" }).init(
  () => {
    console.log("[DB] 已连接");
    return { getUser: (id: number) => ({ id, name: "Alice" }) };
  },
  { shutdown: () => console.log("[DB] 已断开") } // 退出时自动调用
);

// 2. 业务层 (依赖数据层)
const ServiceModule = defineModule({
  name: "service",
  modules: [DbModule],
}).init((ctx) => ({
  login: (id: number) => {
    const user = ctx.db.getUser(id); // 完全类型推导
    console.log(`[Service] 用户 ${user.name} 登录成功`);
  },
}));

// 3. 组合启动与调用
async function bootstrap() {
  const app = await defineModule({ modules: [ServiceModule] }).start();
  // 打印：[DB] 已连接

  // 模拟接口请求
  app.ctx.service.login(1001);
  // 打印：[Service] 用户 Alice 登录成功

  // 模拟程序退出
  await app.stop();
  // 打印：[DB] 已断开
}

bootstrap();
```

---

## 🧩 模块化设计理念

DI（依赖注入）只是手段，**可组合性**才是目的。模块完全通过输入（`modules`）和输出（`init()` 返回值）进行声明，不绑定任何具体应用。

### 模块分类

| 模块类型     | 定义方式                        | 上下文推导行为                              |
| ------------ | ------------------------------- | ------------------------------------------- |
| **匿名模块** | `defineModule()`                | 返回值直接**平铺**合并进父级 `ctx` 中。     |
| **命名模块** | `defineModule({ name: 'api' })` | 返回值**挂载**到父级 `ctx.api` 命名空间下。 |

### 依赖与环境变量

`init(ctx)` 接收到的 `ctx` 仅包含当前模块所依赖的内容。诸如环境变量、密钥等外部依赖，直接利用闭包获取即可，无需繁琐的映射绑定：

```ts
const ConfigModule = defineModule({ name: "config" }).init(() => ({
  apiKey: process.env.API_KEY!,
}));
```

---

## ⚙️ 生命周期与钩子

`tsdkarc` 提供细粒度的生命周期管理，支持异步操作与失败自动清理。

| 作用域 | 支持的钩子 (Hooks) | 说明 |
| ------ | ------------------ | ---- |

| **模块级**<br>

<br>`init(fn, hooks)` | `beforeBoot`, `afterBoot`, `beforeShutdown`, `shutdown`, `afterShutdown` | 仅影响当前模块自身。 |
| **全局级**<br>

<br>`start(hooks)` | `beforeBoot`, `afterBoot`, `beforeShutdown`, `afterShutdown`<br>

<br>`*EachBoot`, `*EachShutdown` | 掌控整个组合应用。`Each` 类钩子可捕获每个子模块的状态。 |

---

## 🔍 依赖分析与调试

遇到 `Circular dependency detected` 报错时，可使用内置的图谱工具排查：

```ts
console.log(app.graph().formatted);
// 输出示例：
// - app
//   - userService
//     - logger
```

---

## 📖 API 参考

### `defineModule(meta?)`

核心工厂函数，返回 `ModuleDeclaration`。

| 参数              | 类型          | 说明                                          |
| ----------------- | ------------- | --------------------------------------------- |
| `name`            | `string`      | (可选) 定义命名模块，作为导出对象的挂载键名。 |
| `modules`         | `AnyModule[]` | (可选) 声明前置依赖的模块数组。               |
| `ignoreConflicts` | `string[]`    | (可选) 允许同名字段并执行深合并的 Key 列表。  |

### 模块实例方法

- `.init(bootFn, hooks?)`：定义模块实现逻辑。
- `.with(...modules)`：动态追加依赖模块。
- `.start(options?)`：执行初始化，返回启动后的应用实例。
- `.graph()`：输出当前模块的依赖树拓扑。

### 核心类型工具

- `ContextOf<M>`：提取模块最终暴露的完整类型。
- `DepCtxOf<M>`：提取模块所依赖的上下文类型。
- `OwnSliceOf<M>`：提取模块自身 `init()` 返回的类型。

---

## ❓ 常见问题 (FAQ)

**Q: 遇到循环依赖会怎样？**

启动时（`.start()` 阶段）会立即抛出异常并阻断执行。

**Q: 同名字段冲突了怎么办？**

编译期会触发 `FindSliceCollision` TS 错误。若强行 `@ts-ignore`，运行时匿名模块会抛出异常，除非显式配置了 `ignoreConflicts`。

**Q: `ignoreConflicts` 的深合并规则是什么？**

仅对**纯对象**（Plain Object）进行递归合并。数组、实例对象等会直接覆盖。出于安全考虑，系统会严格跳过原型链（`__proto__` / `prototype`）的合并。

**Q: 多路径依赖同一个模块（菱形依赖）会导致重复启动吗？**

不会。系统根据模块对象的**引用**进行去重拓扑排序。共享模块全局仅启动一次，并确保在其所有依赖者之前就绪。
