# har-gen-api

一款基于浏览器 `.har` 文件自动生成前端 Mock 接口文件的工具。
提供 **Vite 插件** 与 **CLI 命令**，帮助你在开发过程中快速搭建本地 Mock 服务，无需手动编写重复的接口数据。

---

## 特性

- 🚀 从 Chrome DevTools 导出的 `.har` 文件中一键提取请求/响应数据
- 📦 自动生成 Mock 接口文件，文件所在路径是接口路径和请求方式组合
- ⚡ 内置 Vite 插件，开发环境下实时拦截请求并返回 Mock 数据
- 🧩 支持自定义 `baseURL`、输出目录、是否覆盖相同的请求参数接口
- 🔍 Debug 模式可打印接口调用日志，方便调试

---

## 安装

```bash
npm install har-gen-api --save-dev
# 或
yarn add har-gen-api --dev
```

---

## 使用

### 1️⃣ 导出 HAR 文件

1. 打开 Chrome 浏览器，按 **F12** 进入开发者工具。
2. 切换到 **Network** 面板，刷新页面或操作你的应用。
3. 右键任意请求 → **Save all as HAR with content**（或点击导出按钮），保存为 `.har` 文件。

> 💡 确保 HAR 文件中包含完整的请求 URL、方法、请求头和响应体。

### 2️⃣ 生成 Mock 接口文件（CLI）

在项目根目录执行：

```bash
npx har-gen-api
```

然后根据提示完成交互：

```
? 请选择 HAR 文件（弹出选择文件窗口）

? 请输入生成的接口文件目录 (默认: mock)

? 请输入 baseURL 路径 (默认: /api)

? 是否覆盖相同的请求参数接口 (y/N)
```

执行后会在指定目录下生成对应的接口文件，例如：

```
mock/
├── login.post
├── getUser.get
└── ...
```

### 3️⃣ 集成到 Vite 项目

在 `vite.config.ts` 中添加插件：

```ts
import { defineConfig } from 'vite'
import { mockServer } from 'har-gen-api/vite'

export default defineConfig({
  plugins: [
    mockServer({
      include: 'mock',           // 扫描的目录，存放生成的接口文件
      baseURL: '/api',           // 需要拦截的接口前缀
      enabled: true,             // 是否启用 Mock 服务
      debug: true                // 是否打印请求日志
    })
  ]
})
```

#### 插件参数说明

| 参数        | 类型        | 默认值     | 说明                                         |
| ----------- | ----------- | ---------- | -------------------------------------------- |
| `include` | `string`  | `'mock'` | 存放接口文件的目录（相对于项目根目录）       |
| `baseURL` | `string`  | `'/api'` | 需要 Mock 的接口基础路径                     |
| `enabled` | `boolean` | `true`   | 是否启用 Mock 服务                           |
| `debug`   | `boolean` | `false`  | 开启后控制台会打印每个被拦截的请求方法和路径 |

---

## 接口文件格式

生成的接口文件可以是 `.get` 或 `.post` 文件，分别对应 GET 和 POST 请求。

**示例：`getUser.get`**

```json
{
  "status": 200,
  "data": {
    "id": 1,
    "name": "admin"
  }
}
```

功能持续完善中，欢迎提交 Issue 或 PR 来改进这个工具！
